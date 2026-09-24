import { apiConfig, isRelationalCloudEnabled, isSnapshotFallbackEnabled, supabaseConfig } from '@/lib/platformConfig';
import { publicShareEventToBuyerRoomEvent, type PublicShareEventRow } from '@/lib/buyerDealRoom';
import { buildDocumentStoragePath, explainUnopenableCloudDocument } from '@/lib/documentStoragePath';
import { createId, todayStamp } from '@/lib/xbarRuntime';
import { WORKSPACE_SCHEMA_VERSION } from '@/store/xbarStoreHelpers';
import { intakeIdentityChanged, type IntakeIdentity } from '@/store/xbarStoreLogic';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { isNavigableFileUrl } from '@/lib/navigableFileUrl';
import { openLocalFile } from '@/lib/localFileVault';
import { vaultOwnerId } from '@/lib/vaultOwner';
import { subscriptionFromCloudRow } from '@/lib/cloudSubscription';
import type { Session } from '@supabase/supabase-js';
import type {
  DocumentRecord,
  BuyerRoomEvent,
  ExpenseReceipt,
  HorseRecord,
  IntakeBatch,
  OwnershipRecord,
  RanchAsset,
  SalesLead,
  SharedChannel,
  SharedListingRecord,
  SubscriptionProfile,
  UserRole,
  WorkspaceInvitationRecord,
  WorkspaceMemberRecord,
  WorkspaceProfile,
} from '@/types/xbar';

type CloudWorkspaceBackup = {
  app?: string;
  version?: number;
  exportedAt?: string;
  workspace?: {
    horses?: HorseRecord[];
    documents?: DocumentRecord[];
    intakeBatches?: IntakeBatch[];
    ownershipRecords?: OwnershipRecord[];
    expenseReceipts?: ExpenseReceipt[];
    ranchAssets?: RanchAsset[];
    subscription?: SubscriptionProfile;
    salesLeads?: SalesLead[];
    sharedListings?: SharedListingRecord[];
    workspaceMembers?: WorkspaceMemberRecord[];
    workspaceInvitations?: WorkspaceInvitationRecord[];
    workspaceProfile?: WorkspaceProfile;
  };
};

class WorkspaceSaveAccessError extends Error {}

type RelationalMirrorResult = {
  allowSnapshotFallback?: boolean;
  ok: boolean;
  message: string;
  workspaceId?: string;
  /*
   * Whether the DOCUMENTS upsert committed, which is not the same question as
   * whether the save succeeded.
   *
   * The relational save is a sequence of independent statements, not a
   * transaction: `documents` goes up, then six more tables. If a later one
   * fails, `ok` is false while those document rows are already committed and
   * already counted by `xbar_workspace_storage_bytes`. A caller holding a
   * reservation for those bytes has to release it anyway, or it counts them
   * twice -- once in the server total and once in its own staged figure.
   */
  documentsPersisted?: boolean;
};

type CloudSaveResult = {
  ok: boolean;
  message: string;
  updatedAt?: string;
  workspaceId?: string;
  /*
   * Whether the RELATIONAL rows were written, which is not the same question as
   * `ok`. With the snapshot fallback enabled a rejected relational save still
   * reports success once the legacy snapshot lands, and callers that care about
   * what the database now holds -- the document capacity gate, which reads
   * `xbar_workspace_storage_bytes` -- cannot tell the two apart from `ok`.
   */
  relationalRowsPersisted?: boolean;
};

type WorkspaceAccessProfile = {
  workspaceId: string | null;
  workspaceRole: UserRole;
  source: 'workspace-owner' | 'workspace-membership' | 'session';
};

type RelationalWorkspaceRow = {
  payload?: unknown;
  updated_at?: string | null;
};

type RelationalMembershipRow = {
  email?: string | null;
  role?: string | null;
  status?: string | null;
  payload?: unknown;
  updated_at?: string | null;
};

const userRoles: UserRole[] = ['Admin', 'Ranch Manager', 'Owner', 'Medical Lead', 'Sales Lead'];

function sanitizeStorageSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'record'
  );
}

function normalizeWorkspaceRole(value: unknown): UserRole | null {
  return typeof value === 'string' && userRoles.includes(value as UserRole) ? (value as UserRole) : null;
}

function normalizeWorkspaceEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function resolveSessionRole(session: Session) {
  return (
    normalizeWorkspaceRole(session.user.app_metadata?.workspace_role) ??
    normalizeWorkspaceRole(session.user.app_metadata?.role) ??
    normalizeWorkspaceRole(session.user.user_metadata?.workspace_role) ??
    normalizeWorkspaceRole(session.user.user_metadata?.role) ??
    'Owner'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractPayloadList<T>(rows: RelationalWorkspaceRow[] | null | undefined): T[] {
  return (rows ?? []).flatMap((row) => (isRecord(row.payload) ? [row.payload as T] : []));
}

function extractPayloadItem<T>(row: RelationalWorkspaceRow | null | undefined): T | undefined {
  return row && isRecord(row.payload) ? (row.payload as T) : undefined;
}

function pickNewestTimestamp(values: Array<string | null | undefined>) {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? ''
  );
}

function normalizeBackup(backup: unknown): CloudWorkspaceBackup | null {
  if (!backup || typeof backup !== 'object') {
    return null;
  }

  const payload = backup as CloudWorkspaceBackup;
  if (!payload.workspace || typeof payload.workspace !== 'object') {
    return null;
  }

  return payload;
}

async function getActiveSession() {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const { data, error } = await client.auth.getSession();
  if (error) {
    throw error;
  }

  return data.session;
}

async function acceptPendingWorkspaceInvitation(session: Session) {
  const client = getSupabaseClient();
  if (!client || !session.user.email) {
    return null;
  }

  const normalizedEmail = normalizeWorkspaceEmail(session.user.email);
  if (!normalizedEmail) {
    return null;
  }

  const { data: invitation, error: invitationError } = await client
    .from('workspace_invitations')
    .select('workspace_id, invitation_id, role, email, payload')
    .eq('status', 'pending')
    .eq('email', normalizedEmail)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (invitationError || !invitation?.workspace_id) {
    return null;
  }

  // The server verifies the current confirmed email, locks the pending invite,
  // and applies its assigned role atomically. Client-selected roles are not
  // authorization, and two browser writes could leave a half-accepted invite.
  const { data: accepted, error } = await client.rpc('xbar_accept_workspace_invitation', {
    p_workspace_id: invitation.workspace_id,
    p_invitation_id: invitation.invitation_id,
  });
  const role = normalizeWorkspaceRole(accepted?.role);
  if (error || typeof accepted?.workspaceId !== 'string' || !role) {
    return null;
  }

  return {
    workspaceId: accepted.workspaceId,
    role,
  };
}

export async function loadWorkspaceAccessProfile(sessionOverride?: Session | null): Promise<WorkspaceAccessProfile> {
  const session = sessionOverride ?? (await getActiveSession());
  if (!session?.user) {
    return {
      workspaceId: null,
      workspaceRole: 'Owner',
      source: 'session',
    };
  }

  if (!isRelationalCloudEnabled()) {
    return {
      workspaceId: null,
      workspaceRole: resolveSessionRole(session),
      source: 'session',
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      workspaceId: null,
      workspaceRole: resolveSessionRole(session),
      source: 'session',
    };
  }

  const { data: ownedWorkspace, error: ownedWorkspaceError } = await client
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', session.user.id)
    .eq('workspace_key', 'primary')
    .maybeSingle();

  if (!ownedWorkspaceError && ownedWorkspace?.id) {
    return {
      workspaceId: ownedWorkspace.id as string,
      workspaceRole: 'Admin',
      source: 'workspace-owner',
    };
  }

  const acceptedInvitation = await acceptPendingWorkspaceInvitation(session);
  if (acceptedInvitation?.workspaceId) {
    return {
      workspaceId: acceptedInvitation.workspaceId,
      workspaceRole: acceptedInvitation.role,
      source: 'workspace-membership',
    };
  }

  const { data: membership, error: membershipError } = await client
    .from('workspace_memberships')
    .select('workspace_id, role')
    .eq('user_id', session.user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!membershipError && membership?.workspace_id) {
    return {
      workspaceId: membership.workspace_id as string,
      workspaceRole: normalizeWorkspaceRole(membership.role) ?? resolveSessionRole(session),
      source: 'workspace-membership',
    };
  }

  return {
    workspaceId: null,
    workspaceRole: 'Admin',
    source: 'session',
  };
}

/*
 * Re-read just the subscription profile for one workspace.
 *
 * The billing screen polls this after a completed Stripe checkout: the page
 * comes back to /billing via a full navigation, and the only thing that can
 * tell it the payment landed is the row the webhook writes on
 * `checkout.session.completed`. It reads the same canonical columns as the
 * workspace backup load and maps through the same `subscriptionFromCloudRow`,
 * so a polled profile and a hydrated one can never disagree.
 *
 * A failed read is `ok: false`, never a stale profile: the poll treats unknown
 * as "not yet", and confirming from a read that errored would report a payment
 * the deployment cannot see.
 */
export async function refreshWorkspaceSubscriptionProfile(
  workspaceId: string,
): Promise<{ ok: true; profile: SubscriptionProfile | null } | { ok: false; message: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: 'Supabase is not configured for this build.' };
  }
  if (!workspaceId) {
    return { ok: false, message: 'No cloud workspace is connected for this session.' };
  }

  const { data, error } = await client
    .from('workspace_subscription_profiles')
    .select('tier, billing_state, monthly_rate, payload, updated_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message };
  }

  // A row that has never been written is not an error; it is "not yet".
  return { ok: true, profile: data ? (subscriptionFromCloudRow(data) ?? null) : null };
}

export async function loadPublicBuyerRoomEventsFromCloud(): Promise<
  { ok: true; events: BuyerRoomEvent[] } | { ok: false; message: string }
> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: 'Cloud buyer activity is unavailable in this build.' };
  }

  try {
    const session = await getActiveSession();
    if (!session?.user) {
      return { ok: false, message: 'Sign in to refresh buyer activity from shared links.' };
    }

    const accessProfile = await loadWorkspaceAccessProfile(session);
    if (!accessProfile.workspaceId) {
      return { ok: false, message: 'No cloud workspace is connected for buyer activity.' };
    }

    const { data, error } = await client
      .from('public_share_events')
      .select('id, listing_id, horse_id, event_type, metadata, viewed_at, created_at')
      .eq('workspace_id', accessProfile.workspaceId)
      .order('viewed_at', { ascending: false })
      .limit(1000);

    if (error) {
      return { ok: false, message: error.message };
    }

    const events = ((data ?? []) as PublicShareEventRow[])
      .map(publicShareEventToBuyerRoomEvent)
      .filter((event): event is BuyerRoomEvent => Boolean(event));

    return { ok: true, events };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to refresh buyer activity.',
    };
  }
}

export async function recordBuyerRoomSellerResponseInCloud(input: {
  replyToEventId: string;
  note: string;
}): Promise<
  | { ok: true; cloudAttempted: boolean; message: string; event?: BuyerRoomEvent }
  | { ok: false; cloudAttempted: true; message: string }
> {
  if (!input.replyToEventId.startsWith('public-share-')) {
    return { ok: true, cloudAttempted: false, message: 'Seller response recorded in the local buyer timeline.' };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { ok: true, cloudAttempted: false, message: 'Seller response recorded in the local buyer timeline.' };
  }

  try {
    const session = await getActiveSession();
    if (!session?.user) {
      return { ok: true, cloudAttempted: false, message: 'Seller response recorded in the local buyer timeline.' };
    }

    const accessProfile = await loadWorkspaceAccessProfile(session);
    if (!accessProfile.workspaceId) {
      return { ok: true, cloudAttempted: false, message: 'Seller response recorded in the local buyer timeline.' };
    }

    const base = apiConfig.baseUrl ? apiConfig.baseUrl.replace(/\/$/, '') : '';
    const response = await fetch(`${base}/api/buyer/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: accessProfile.workspaceId,
        replyToEventId: input.replyToEventId,
        note: input.note,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      event?: PublicShareEventRow;
    };
    if (!response.ok || !payload.ok) {
      return {
        ok: false,
        cloudAttempted: true,
        message: payload.message ?? 'The seller response could not be recorded in the cloud buyer timeline.',
      };
    }

    const event = payload.event ? (publicShareEventToBuyerRoomEvent(payload.event) ?? undefined) : undefined;
    return {
      ok: true,
      cloudAttempted: true,
      message: payload.message ?? 'Seller response recorded in the cloud buyer timeline.',
      event,
    };
  } catch (error) {
    return {
      ok: false,
      cloudAttempted: true,
      message:
        error instanceof Error
          ? error.message
          : 'The seller response could not be recorded in the cloud buyer timeline.',
    };
  }
}

async function ensurePrimaryWorkspace(session: Session, backup: CloudWorkspaceBackup) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase is not configured for this build.');
  }

  const profile = backup.workspace?.workspaceProfile;
  const updatedAt = backup.exportedAt ?? new Date().toISOString();
  const workspaceName = profile?.ranchName?.trim() || 'Primary Ranch';
  const businessName = profile?.businessName?.trim() || 'XBAR';
  const membershipRole = resolveSessionRole(session);

  // Match the workspace used by reads. A teammate must not bootstrap a new
  // personally owned ranch from the shared ranch's snapshot. Lookup failures
  // are not evidence that this account has no workspace.
  const { data: ownedWorkspace, error: ownedError } = await client
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', session.user.id)
    .eq('workspace_key', 'primary')
    .maybeSingle();
  if (ownedError) throw new WorkspaceSaveAccessError(ownedError.message);

  let workspaceId = '';
  if (!ownedWorkspace?.id) {
    const { data: memberships, error: membershipError } = await client
      .from('workspace_memberships')
      .select('workspace_id, role')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .limit(2);
    if (membershipError) throw new WorkspaceSaveAccessError(membershipError.message);
    if ((memberships?.length ?? 0) > 1) {
      throw new WorkspaceSaveAccessError(
        'Multiple ranch memberships were found. Saving is paused until your ranch administrator resolves the active membership.',
      );
    }
    const membership = memberships?.[0];
    if (membership?.workspace_id) {
      // Mirrors current server write policy; record access does not grant writes.
      if (membership.role !== 'Admin') {
        throw new WorkspaceSaveAccessError(
          'Your ranch access is read-only. Ask the ranch administrator to save these changes.',
        );
      }
      workspaceId = membership.workspace_id as string;
    } else if (
      backup.workspace?.workspaceMembers?.some(
        (member) =>
          member.source === 'Invite' &&
          normalizeWorkspaceEmail(member.email) === normalizeWorkspaceEmail(session.user.email),
      )
    ) {
      // A previously invited snapshot is not a request to create a personal ranch.
      throw new WorkspaceSaveAccessError(
        'Your shared ranch access could not be verified. Refresh your access before saving.',
      );
    }
  }

  if (!workspaceId) {
    const { data: workspaceRow, error: workspaceError } = await client
      .from('workspaces')
      .upsert(
        {
          owner_user_id: session.user.id,
          workspace_key: 'primary',
          name: workspaceName,
          business_name: businessName,
          updated_at: updatedAt,
        },
        { onConflict: 'owner_user_id,workspace_key' },
      )
      .select('id')
      .single();

    if (workspaceError || !workspaceRow?.id) {
      throw new Error(workspaceError?.message ?? 'Unable to create the primary workspace record.');
    }

    workspaceId = workspaceRow.id as string;

    const { error: membershipError } = await client.from('workspace_memberships').upsert(
      {
        workspace_id: workspaceId,
        user_id: session.user.id,
        email: normalizeWorkspaceEmail(session.user.email),
        display_name: session.user.user_metadata?.full_name ?? session.user.user_metadata?.name ?? membershipRole,
        role: membershipRole,
        status: 'active',
        payload: {
          id: `member-${normalizeWorkspaceEmail(session.user.email) || session.user.id}`,
          email: normalizeWorkspaceEmail(session.user.email),
          role: membershipRole,
          status: 'Active',
          joinedAt: updatedAt,
          source: 'Owner',
        },
        updated_at: updatedAt,
      },
      { onConflict: 'workspace_id,email' },
    );

    if (membershipError) {
      throw new Error(membershipError.message);
    }
  }

  const { error: profileError } = await client.from('workspace_profiles').upsert(
    {
      workspace_id: workspaceId,
      ranch_name: workspaceName,
      business_name: businessName,
      default_owner_name: profile?.defaultOwnerName ?? '',
      default_owner_entity: profile?.defaultOwnerEntity ?? '',
      ranch_manager_name: profile?.ranchManagerName ?? '',
      operations_email: profile?.operationsEmail ?? '',
      default_barn: profile?.defaultBarn ?? '',
      default_pasture: profile?.defaultPasture ?? '',
      payload: profile ?? {},
      updated_at: updatedAt,
    },
    { onConflict: 'workspace_id' },
  );

  if (profileError) {
    throw new Error(profileError.message);
  }

  return workspaceId;
}

async function replaceWorkspaceRows(params: {
  table:
    | 'horses'
    | 'documents'
    | 'intake_batches'
    | 'ownership_records'
    | 'expense_receipts'
    | 'ranch_assets'
    | 'sales_leads'
    | 'shared_listings';
  idColumn: string;
  workspaceId: string;
  rows: Record<string, unknown>[];
}) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase is not configured for this build.');
  }

  const { table, idColumn, workspaceId, rows } = params;
  const { data: existingRows, error: existingError } = await client
    .from(table)
    .select(idColumn)
    .eq('workspace_id', workspaceId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const nextIds = new Set(rows.map((row) => String(row[idColumn])));
  const staleIds = ((existingRows ?? []) as unknown as Array<Record<string, unknown>>)
    .map((row) => String(row[idColumn] ?? ''))
    .filter((id) => id && !nextIds.has(id));

  if (staleIds.length) {
    const { error: deleteError } = await client
      .from(table)
      .delete()
      .eq('workspace_id', workspaceId)
      .in(idColumn, staleIds);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  if (!rows.length) {
    return;
  }

  const { error: upsertError } = await client.from(table).upsert(rows, {
    onConflict: `workspace_id,${idColumn}`,
  });

  if (upsertError) {
    throw new Error(upsertError.message);
  }
}

async function saveWorkspaceSnapshotToCloud(backup: unknown, session: Session, updatedAt: string) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: 'Supabase is not configured for this build.' } as const;
  }

  const { error } = await client.from(supabaseConfig.workspaceTable).upsert(
    {
      user_id: session.user.id,
      workspace_key: 'primary',
      payload: backup,
      updated_at: updatedAt,
    },
    { onConflict: 'user_id,workspace_key' },
  );

  if (error) {
    return { ok: false, message: error.message } as const;
  }

  return {
    ok: true,
    message: 'Legacy snapshot backup updated.',
    updatedAt,
  } as const;
}

async function saveWorkspaceBackupToRelationalCloud(
  backup: unknown,
  session: Session,
): Promise<RelationalMirrorResult> {
  const normalized = normalizeBackup(backup);
  if (!normalized) {
    return {
      ok: false,
      message: 'Workspace backup payload is missing the normalized mirror data.',
    };
  }

  // Set the moment the documents upsert commits, and reported even when a LATER
  // table fails: those rows are in the database whatever happens next.
  let documentsPersisted = false;

  try {
    const workspaceId = await ensurePrimaryWorkspace(session, normalized);
    const updatedAt = normalized.exportedAt ?? new Date().toISOString();
    const workspace = normalized.workspace ?? {};

    // Access changes use explicit cloud operations. An old ranch snapshot must
    // never re-create members or reopen accepted/revoked invitations.

    await replaceWorkspaceRows({
      table: 'horses',
      idColumn: 'horse_id',
      workspaceId,
      rows: (workspace.horses ?? []).map((horse) => ({
        workspace_id: workspaceId,
        horse_id: horse.id,
        name: horse.name,
        barn_name: horse.barnName,
        segment: horse.segment,
        status: horse.status,
        registration_number: horse.registrationNumber,
        owner_name: horse.owner,
        payload: horse,
        updated_at: updatedAt,
      })),
    });

    await replaceWorkspaceRows({
      table: 'documents',
      idColumn: 'document_id',
      workspaceId,
      rows: (workspace.documents ?? []).map((document) => ({
        workspace_id: workspaceId,
        document_id: document.id,
        horse_id: document.horseId ?? '',
        title: document.title,
        document_type: document.type,
        source: document.source,
        state: document.state,
        confidence: document.confidence,
        duplicate_risk: document.duplicateRisk,
        // Persist the upload size so the server-side storage-limit trigger and
        // xbar_workspace_storage_bytes count this direct-to-Storage upload path,
        // not just the API-generated documents. Zero when the file was never
        // sized (e.g. metadata-only rows).
        size_bytes: document.fileSizeBytes ?? 0,
        payload: document,
        updated_at: updatedAt,
      })),
    });

    documentsPersisted = true;

    await replaceWorkspaceRows({
      table: 'intake_batches',
      idColumn: 'intake_batch_id',
      workspaceId,
      rows: (workspace.intakeBatches ?? []).map((batch) => ({
        workspace_id: workspaceId,
        intake_batch_id: batch.id,
        label: batch.label,
        source: batch.source,
        state: batch.state,
        received_at: batch.receivedAt,
        payload: batch,
        updated_at: updatedAt,
      })),
    });

    await replaceWorkspaceRows({
      table: 'ownership_records',
      idColumn: 'ownership_record_id',
      workspaceId,
      rows: (workspace.ownershipRecords ?? []).map((record) => ({
        workspace_id: workspaceId,
        ownership_record_id: record.id,
        horse_id: record.horseId,
        legal_owner: record.legalOwner,
        transfer_status: record.transferStatus,
        compliance_deadline: record.complianceDeadline,
        payload: record,
        updated_at: updatedAt,
      })),
    });

    await replaceWorkspaceRows({
      table: 'expense_receipts',
      idColumn: 'receipt_id',
      workspaceId,
      rows: (workspace.expenseReceipts ?? []).map((receipt) => ({
        workspace_id: workspaceId,
        receipt_id: receipt.id,
        horse_id: receipt.horseId ?? '',
        title: receipt.title,
        category: receipt.category,
        vendor: receipt.vendor,
        amount: receipt.amount,
        receipt_date: receipt.receiptDate,
        payload: receipt,
        updated_at: updatedAt,
      })),
    });

    await replaceWorkspaceRows({
      table: 'ranch_assets',
      idColumn: 'asset_id',
      workspaceId,
      rows: (workspace.ranchAssets ?? []).map((asset) => ({
        workspace_id: workspaceId,
        asset_id: asset.id,
        name: asset.name,
        category: asset.category,
        status: asset.status,
        location: asset.location,
        condition: asset.condition,
        payload: asset,
        updated_at: updatedAt,
      })),
    });

    await replaceWorkspaceRows({
      table: 'sales_leads',
      idColumn: 'lead_id',
      workspaceId,
      rows: (workspace.salesLeads ?? []).map((lead) => ({
        workspace_id: workspaceId,
        lead_id: lead.id,
        horse_id: lead.horseId,
        lead_name: lead.name,
        channel: lead.channel,
        stage: lead.stage,
        last_touch: lead.lastTouch,
        next_follow_up: lead.nextFollowUp ?? '',
        payload: lead,
        updated_at: updatedAt,
      })),
    });

    await replaceWorkspaceRows({
      table: 'shared_listings',
      idColumn: 'listing_id',
      workspaceId,
      rows: (workspace.sharedListings ?? []).map((listing) => ({
        workspace_id: workspaceId,
        listing_id: listing.id,
        horse_id: listing.horseId,
        share_path: listing.sharePath,
        access_mode: listing.accessMode,
        share_token: listing.shareToken,
        token_issued_at: listing.tokenIssuedAt || updatedAt,
        published_at: listing.state === 'Live' ? updatedAt : null,
        state: listing.state,
        channels: listing.channels,
        payload: listing,
        updated_at: updatedAt,
      })),
    });

    return {
      ok: true,
      message: 'Relational workspace updated.',
      workspaceId,
      documentsPersisted,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to update the relational workspace.',
      allowSnapshotFallback: !(error instanceof WorkspaceSaveAccessError),
      documentsPersisted,
    };
  }
}

async function loadWorkspaceBackupFromRelationalCloud(session: Session) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: 'Supabase is not configured for this build.' } as const;
  }

  const accessProfile = await loadWorkspaceAccessProfile(session);
  if (!accessProfile.workspaceId) {
    return { ok: false, message: 'No relational workspace exists for this account yet.' } as const;
  }

  const workspaceId = accessProfile.workspaceId;
  const [
    membershipsResult,
    invitationsResult,
    horsesResult,
    documentsResult,
    intakeBatchesResult,
    ownershipRecordsResult,
    expenseReceiptsResult,
    ranchAssetsResult,
    salesLeadsResult,
    sharedListingsResult,
    subscriptionResult,
    profileResult,
  ] = await Promise.all([
    client
      .from('workspace_memberships')
      .select('email, role, status, payload, updated_at')
      .eq('workspace_id', workspaceId),
    client.from('workspace_invitations').select('payload, updated_at').eq('workspace_id', workspaceId),
    client.from('horses').select('payload, updated_at').eq('workspace_id', workspaceId),
    client.from('documents').select('payload, updated_at').eq('workspace_id', workspaceId),
    client.from('intake_batches').select('payload, updated_at').eq('workspace_id', workspaceId),
    client.from('ownership_records').select('payload, updated_at').eq('workspace_id', workspaceId),
    client.from('expense_receipts').select('payload, updated_at').eq('workspace_id', workspaceId),
    client.from('ranch_assets').select('payload, updated_at').eq('workspace_id', workspaceId),
    client.from('sales_leads').select('payload, updated_at').eq('workspace_id', workspaceId),
    client.from('shared_listings').select('payload, updated_at').eq('workspace_id', workspaceId),
    client
      .from('workspace_subscription_profiles')
      .select('tier, billing_state, monthly_rate, payload, updated_at')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    client.from('workspace_profiles').select('payload, updated_at').eq('workspace_id', workspaceId).maybeSingle(),
  ]);

  const errors = [
    membershipsResult.error,
    invitationsResult.error,
    horsesResult.error,
    documentsResult.error,
    intakeBatchesResult.error,
    ownershipRecordsResult.error,
    expenseReceiptsResult.error,
    ranchAssetsResult.error,
    salesLeadsResult.error,
    sharedListingsResult.error,
    subscriptionResult.error,
    profileResult.error,
  ].filter(Boolean);

  if (errors.length) {
    return {
      ok: false,
      message: errors[0]?.message ?? 'Unable to load relational workspace data.',
    } as const;
  }

  const backup: CloudWorkspaceBackup = {
    app: 'XBAR',
    // The constant, never a literal: this was hardcoded 8 and would have gone
    // on claiming 8 the moment the schema moved, so a cloud snapshot would
    // import as already-current and skip the very normalization the bump
    // exists to run.
    version: WORKSPACE_SCHEMA_VERSION,
    exportedAt: pickNewestTimestamp([
      ...(membershipsResult.data ?? []).map((row) => row.updated_at),
      ...(invitationsResult.data ?? []).map((row) => row.updated_at),
      ...(horsesResult.data ?? []).map((row) => row.updated_at),
      ...(documentsResult.data ?? []).map((row) => row.updated_at),
      ...(intakeBatchesResult.data ?? []).map((row) => row.updated_at),
      ...(ownershipRecordsResult.data ?? []).map((row) => row.updated_at),
      ...(expenseReceiptsResult.data ?? []).map((row) => row.updated_at),
      ...(ranchAssetsResult.data ?? []).map((row) => row.updated_at),
      ...(salesLeadsResult.data ?? []).map((row) => row.updated_at),
      ...(sharedListingsResult.data ?? []).map((row) => row.updated_at),
      subscriptionResult.data?.updated_at,
      profileResult.data?.updated_at,
    ]),
    workspace: {
      workspaceMembers: (membershipsResult.data ?? []).flatMap((row) => {
        if (isRecord(row.payload)) {
          return [row.payload as unknown as WorkspaceMemberRecord];
        }

        const email = normalizeWorkspaceEmail((row as RelationalMembershipRow).email);
        if (!email) {
          return [];
        }

        return [
          {
            id: `member-${email}`,
            email,
            role: normalizeWorkspaceRole((row as RelationalMembershipRow).role) ?? 'Owner',
            status: (row as RelationalMembershipRow).status === 'inactive' ? 'Inactive' : 'Active',
            joinedAt: row.updated_at ?? new Date().toISOString(),
            source: 'Invite',
          } satisfies WorkspaceMemberRecord,
        ];
      }),
      workspaceInvitations: extractPayloadList<WorkspaceInvitationRecord>(invitationsResult.data),
      horses: extractPayloadList<HorseRecord>(horsesResult.data),
      documents: extractPayloadList<DocumentRecord>(documentsResult.data),
      intakeBatches: extractPayloadList<IntakeBatch>(intakeBatchesResult.data),
      ownershipRecords: extractPayloadList<OwnershipRecord>(ownershipRecordsResult.data),
      expenseReceipts: extractPayloadList<ExpenseReceipt>(expenseReceiptsResult.data),
      ranchAssets: extractPayloadList<RanchAsset>(ranchAssetsResult.data),
      salesLeads: extractPayloadList<SalesLead>(salesLeadsResult.data),
      sharedListings: extractPayloadList<SharedListingRecord>(sharedListingsResult.data),
      subscription: subscriptionFromCloudRow(subscriptionResult.data),
      workspaceProfile: extractPayloadItem<WorkspaceProfile>(profileResult.data),
    },
  };

  const hasWorkspaceData = Boolean(
    backup.workspace?.horses?.length ||
    backup.workspace?.workspaceMembers?.length ||
    backup.workspace?.workspaceInvitations?.length ||
    backup.workspace?.documents?.length ||
    backup.workspace?.intakeBatches?.length ||
    backup.workspace?.ownershipRecords?.length ||
    backup.workspace?.expenseReceipts?.length ||
    backup.workspace?.ranchAssets?.length ||
    backup.workspace?.salesLeads?.length ||
    backup.workspace?.sharedListings?.length ||
    backup.workspace?.subscription ||
    backup.workspace?.workspaceProfile,
  );

  if (!hasWorkspaceData) {
    return { ok: false, message: 'No relational workspace records are stored for this account yet.' } as const;
  }

  return {
    ok: true,
    backup,
    updatedAt: backup.exportedAt ?? '',
  } as const;
}

export async function saveWorkspaceBackupToCloud(backup: unknown): Promise<CloudSaveResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: 'Supabase is not configured for this build.' };
  }

  const session = await getActiveSession();
  if (!session?.user) {
    return { ok: false, message: 'Sign in before syncing this workspace.' };
  }

  const updatedAt = new Date().toISOString();
  if (isRelationalCloudEnabled()) {
    const relational = await saveWorkspaceBackupToRelationalCloud(backup, session);
    if (relational.ok) {
      if (isSnapshotFallbackEnabled()) {
        const snapshot = await saveWorkspaceSnapshotToCloud(backup, session, updatedAt);
        return {
          ok: true,
          message: snapshot.ok
            ? 'Cloud sync complete. Relational workspace updated.'
            : `Relational workspace updated, but snapshot backup failed: ${snapshot.message}`,
          updatedAt,
          workspaceId: relational.workspaceId,
          relationalRowsPersisted: relational.documentsPersisted === true,
        };
      }

      return {
        ok: true,
        message: 'Cloud sync complete. Relational workspace updated.',
        updatedAt,
        workspaceId: relational.workspaceId,
        relationalRowsPersisted: relational.documentsPersisted === true,
      };
    }

    if (!isSnapshotFallbackEnabled() || relational.allowSnapshotFallback === false) {
      return {
        relationalRowsPersisted: relational.documentsPersisted === true,
        ok: false,
        message: relational.message,
        updatedAt,
      };
    }

    const snapshot = await saveWorkspaceSnapshotToCloud(backup, session, updatedAt);
    if (snapshot.ok) {
      /*
       * `relationalRowsPersisted` is the DOCUMENTS question, not the `ok`
       * question, and on this path the answer is usually no: the snapshot
       * landed and the rancher's work is safe, which is what `ok` is about,
       * while nothing a caller reads from `documents` has moved.
       *
       * Usually, but not always. The relational save is a sequence of
       * statements rather than a transaction, so the documents upsert can
       * commit and a later table still fail. Those rows are then in the
       * database and in `xbar_workspace_storage_bytes`, and a reservation held
       * for them counts the same bytes twice -- refusing uploads that fit.
       * Asserting `false` here would cause exactly that, so the flag is
       * forwarded rather than assumed either way.
       */
      return {
        ok: true,
        message: `Relational workspace unavailable. Saved a legacy snapshot instead. ${relational.message}`,
        updatedAt,
        relationalRowsPersisted: relational.documentsPersisted === true,
      };
    }

    return {
      ok: false,
      message: `${relational.message} ${snapshot.message}`.trim(),
      updatedAt,
      relationalRowsPersisted: relational.documentsPersisted === true,
    };
  }

  const snapshot = await saveWorkspaceSnapshotToCloud(backup, session, updatedAt);
  if (!snapshot.ok) {
    return { ok: false, message: snapshot.message, updatedAt };
  }

  return { ok: true, message: 'Cloud sync complete. Legacy snapshot updated.', updatedAt };
}

export async function loadWorkspaceBackupFromCloud() {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: 'Supabase is not configured for this build.' } as const;
  }

  const session = await getActiveSession();
  if (!session?.user) {
    return { ok: false, message: 'Sign in before pulling cloud data.' } as const;
  }

  if (isRelationalCloudEnabled()) {
    const relational = await loadWorkspaceBackupFromRelationalCloud(session);
    if (relational.ok) {
      return relational;
    }

    if (!isSnapshotFallbackEnabled()) {
      return relational;
    }
  }

  const { data, error } = await client
    .from(supabaseConfig.workspaceTable)
    .select('payload, updated_at')
    .eq('user_id', session.user.id)
    .eq('workspace_key', 'primary')
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message } as const;
  }

  if (!data?.payload) {
    return { ok: false, message: 'No cloud workspace has been saved for this account yet.' } as const;
  }

  return {
    ok: true,
    backup: data.payload,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : '',
  } as const;
}

export async function uploadMediaAssetToCloud(params: { file: File; horseId: string }) {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const session = await getActiveSession();
  if (!session?.user) {
    return null;
  }

  const extension = params.file.name.includes('.') ? params.file.name.split('.').pop() : 'bin';
  const fileName = `${createId('media')}.${extension}`;
  const path = `${session.user.id}/horses/${sanitizeStorageSegment(params.horseId)}/${fileName}`;
  const { error } = await client.storage.from(supabaseConfig.mediaBucket).upload(path, params.file, {
    upsert: false,
    contentType: params.file.type || undefined,
  });

  if (error) {
    throw error;
  }

  // The horse-media bucket is private, so there is deliberately no public URL
  // here. Callers persist `storagePath` and every render resolves a
  // short-lived signed URL via getHorseMediaSignedUrl (workspace members) or
  // the token-gated buyer media endpoint (shared listings).
  return {
    storagePath: path,
  };
}

/**
 * How long a signed horse-media URL stays valid, in seconds.
 *
 * Fifteen minutes covers an in-app browsing session; the URL is re-resolved on
 * every render, so a stale link never lingers. Buyer-facing links minted by
 * the server for shared listings use their own (longer) TTL defined next to
 * that endpoint.
 */
export const HORSE_MEDIA_SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Mint a short-lived signed URL for a horse-media object.
 *
 * The caller must be signed in and entitled to read the object under the
 * bucket's storage policies (the uploader, or a member of the workspace whose
 * horse references it). Returns null when the client is unavailable, the
 * session is missing, or storage refuses -- the render layer treats null as
 * "no image" and shows its fallback, never a broken link.
 */
export async function getHorseMediaSignedUrl(
  storagePath: string,
  expiresInSeconds: number = HORSE_MEDIA_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const session = await getActiveSession();
  if (!session?.user) {
    return null;
  }

  const { data, error } = await client.storage
    .from(supabaseConfig.mediaBucket)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

/**
 * Put a document's bytes where the whole ranch can reach them.
 *
 * Keyed to the WORKSPACE, not to the person uploading. It used to be keyed to
 * `session.user.id`, and since `horse-documents` is a private bucket whose
 * policy compares that first segment against membership, every teammate saw the
 * document listed and was refused when they opened it. The object path and the
 * `documents` row now answer to the same workspace.
 *
 * When no workspace resolves -- a build with cloud sync off, a session whose
 * membership has not loaded, a signed-out tab -- this returns `null` rather than
 * writing the file somewhere unreadable. The caller reads `null` as "the cloud
 * did not take this file" and keeps the bytes on the device, which is a file the
 * customer still has rather than one nobody can open.
 */
export async function uploadDocumentAssetToCloud(params: {
  file: File;
  horseId?: string;
  /*
   * Who this upload is FOR, captured by the caller before its batch began.
   *
   * This function resolves the destination from the LIVE session, which is the
   * right thing for a one-off upload and the wrong thing inside a long intake:
   * another tab can sign a different account in while files and OCR are still
   * in flight, and then these bytes -- one customer's Coggins, registration
   * papers, vet records -- are written under the REPLACEMENT workspace's
   * prefix, where that workspace's members can read them.
   *
   * The intake's own identity check catches the switch at commit time, but by
   * then the object exists. It stops the row, not the file. So the caller says
   * whose upload this is and it is refused rather than misfiled, which leaves
   * nothing to clean up afterwards: a refusal returns null, the same as any
   * other failed upload, and the file stays on the device as metadata only.
   *
   * Omit both to keep the old behaviour for callers with no batch to belong to.
   */
  expectedIdentity?: IntakeIdentity;
}) {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const session = await getActiveSession();
  if (!session?.user) {
    return null;
  }

  const accessProfile = await loadWorkspaceAccessProfile(session);
  if (
    params.expectedIdentity &&
    intakeIdentityChanged(params.expectedIdentity, {
      userId: session.user.id ?? '',
      workspaceId: accessProfile.workspaceId ?? '',
    })
  ) {
    return null;
  }

  const path = buildDocumentStoragePath({
    workspaceId: accessProfile.workspaceId,
    horseId: params.horseId,
    objectId: createId('document'),
    originalFileName: params.file.name,
  });
  if (!path) {
    return null;
  }

  const { error } = await client.storage.from(supabaseConfig.documentBucket).upload(path, params.file, {
    upsert: false,
    contentType: params.file.type || undefined,
  });

  if (error) {
    throw error;
  }

  return {
    storagePath: path,
  };
}

/**
 * Read the database's authoritative total for objects charged to this
 * workspace. The RPC is security-definer and resolves membership server-side;
 * callers must not fall back to a cached subscription total when it cannot be
 * read, because doing so can upload bytes that the documents trigger rejects.
 */
export async function loadWorkspaceStorageBytes(): Promise<number> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Cloud storage usage is unavailable.');
  }

  const session = await getActiveSession();
  if (!session?.user) {
    throw new Error('Sign in again before uploading documents.');
  }

  const accessProfile = await loadWorkspaceAccessProfile(session);
  if (!accessProfile.workspaceId) {
    throw new Error('Finish workspace setup before uploading documents.');
  }

  const { data, error } = await client.rpc('xbar_workspace_storage_bytes', {
    p_workspace_id: accessProfile.workspaceId,
  });
  if (error) throw error;

  const bytes = typeof data === 'number' ? data : Number(data);
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error('Cloud storage usage returned an invalid value.');
  }
  return bytes;
}

/**
 * Resolve a record to something the browser can open.
 *
 * The on-device vault is consulted before cloud storage, and deliberately so:
 * a file kept locally needs no session, no network and no signed URL, so
 * checking it first is both faster and the only branch that works for the
 * workspaces this product says it supports. `release` is present only for those
 * — an object URL holds the blob in memory until it is revoked.
 */
export async function getDocumentAccessUrl(
  document: Pick<DocumentRecord, 'fileUrl' | 'storagePath' | 'localFileKey'>,
): Promise<
  | {
      ok: true;
      url: string;
      release?: () => void;
      /**
       * False when the file must be downloaded rather than rendered in a tab.
       * Absent for cloud URLs, which are served from Supabase's origin and
       * cannot reach this app's storage whatever their type.
       */
      inlineSafe?: boolean;
      fileName?: string;
    }
  | { ok: false; message: string }
> {
  const directFileUrl = document.fileUrl?.trim();
  if (directFileUrl) {
    /*
     * The scheme is checked HERE, at the point the string leaves the record.
     *
     * `fileUrl` is workspace data, and workspace data can arrive in an imported
     * backup. `openStoredFile` assigns this to a same-origin `about:blank`, so
     * a `javascript:` URL in a backup runs with this app's origin and reads the
     * vault. Refusing at the source means every caller is covered, including
     * ones added later that never think about it.
     */
    if (!isNavigableFileUrl(directFileUrl)) {
      return {
        ok: false,
        message: 'This document points at an address this app will not open. Re-upload the file to fix the record.',
      } as const;
    }

    return {
      ok: true,
      url: directFileUrl,
    } as const;
  }

  if (document.localFileKey) {
    const handle = await openLocalFile(document.localFileKey, vaultOwnerId());
    if (handle) {
      return {
        ok: true,
        url: handle.url,
        release: handle.release,
        // Carried through so the caller downloads rather than navigating. The
        // url is already inert either way; this is what stops a blank tab.
        inlineSafe: handle.inlineSafe,
        fileName: handle.name,
      } as const;
    }
    if (!document.storagePath) {
      return {
        ok: false,
        message: 'This file was saved on a different device or browser, and is not stored on this one.',
      } as const;
    }
  }

  if (!document.storagePath) {
    return {
      ok: false,
      message: 'This document does not have a stored file attached yet.',
    } as const;
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      message: 'Cloud storage is not configured for this build.',
    } as const;
  }

  const session = await getActiveSession();
  if (!session?.user) {
    return {
      ok: false,
      message: 'Sign in to open files stored in cloud storage.',
    } as const;
  }

  const { data, error } = await client.storage
    .from(supabaseConfig.documentBucket)
    .createSignedUrl(document.storagePath, 60 * 5);
  if (error || !data?.signedUrl) {
    // A refusal here is usually not a broken link. Documents uploaded before
    // shared storage sit under the uploader's own id, so a teammate sees the
    // record and is turned away at the file -- and "Object not found" tells
    // them nothing they can act on. The workspace is only looked up on this
    // path, so a normal open still costs one request.
    const accessProfile = await loadWorkspaceAccessProfile(session);
    const legacyExplanation = explainUnopenableCloudDocument({
      storagePath: document.storagePath,
      viewerUserId: session.user.id,
      workspaceId: accessProfile.workspaceId,
    });
    return {
      ok: false,
      message: legacyExplanation ?? error?.message ?? 'Unable to generate a secure file link for this document.',
    } as const;
  }

  return {
    ok: true,
    url: data.signedUrl,
  } as const;
}

async function getCloudWorkspaceContext() {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: 'Supabase is not configured for this build.' } as const;
  }

  const session = await getActiveSession();
  if (!session?.user) {
    return { ok: false, message: 'Sign in before changing cloud workspace access.' } as const;
  }

  const accessProfile = await loadWorkspaceAccessProfile(session);
  if (!accessProfile.workspaceId) {
    return { ok: false, message: 'No cloud workspace is connected to this account yet.' } as const;
  }

  return {
    ok: true,
    client,
    session,
    workspaceId: accessProfile.workspaceId,
  } as const;
}

export async function createWorkspaceInvitationInCloud(invitation: WorkspaceInvitationRecord) {
  const context = await getCloudWorkspaceContext();
  if (!context.ok) {
    return context;
  }

  const { error } = await context.client.from('workspace_invitations').insert({
    workspace_id: context.workspaceId,
    invitation_id: invitation.id,
    email: normalizeWorkspaceEmail(invitation.email),
    role: invitation.role,
    status: invitation.status.toLowerCase(),
    invited_by_user_id: context.session.user.id,
    payload: invitation,
    updated_at: invitation.invitedAt,
  });

  if (error) {
    return { ok: false, message: error.message } as const;
  }

  return { ok: true, message: 'Workspace invitation saved to cloud.' } as const;
}

export async function revokeWorkspaceInvitationInCloud(invitationId: string, acceptedAt?: string) {
  const context = await getCloudWorkspaceContext();
  if (!context.ok) {
    return context;
  }

  const nextStatus = acceptedAt ? 'accepted' : 'revoked';
  const { data: existing, error: existingError } = await context.client
    .from('workspace_invitations')
    .select('payload')
    .eq('workspace_id', context.workspaceId)
    .eq('invitation_id', invitationId)
    .maybeSingle();

  if (existingError || !existing?.payload) {
    return { ok: false, message: existingError?.message ?? 'Invite not found in cloud workspace.' } as const;
  }

  const payload =
    existing.payload && typeof existing.payload === 'object'
      ? {
          ...(existing.payload as Record<string, unknown>),
          status: acceptedAt ? 'Accepted' : 'Revoked',
          ...(acceptedAt ? { acceptedAt } : { revokedAt: new Date().toISOString() }),
        }
      : existing.payload;

  const { error } = await context.client
    .from('workspace_invitations')
    .update({
      status: nextStatus,
      payload,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', context.workspaceId)
    .eq('invitation_id', invitationId);

  if (error) {
    return { ok: false, message: error.message } as const;
  }

  return {
    ok: true,
    message: acceptedAt ? 'Workspace invite accepted in cloud.' : 'Workspace invite revoked in cloud.',
  } as const;
}

export async function removeWorkspaceMemberFromCloud(member: WorkspaceMemberRecord) {
  const context = await getCloudWorkspaceContext();
  if (!context.ok) {
    return context;
  }

  const normalizedEmail = normalizeWorkspaceEmail(member.email);
  const { error } = await context.client
    .from('workspace_memberships')
    .delete()
    .eq('workspace_id', context.workspaceId)
    .eq('email', normalizedEmail);

  if (error) {
    return { ok: false, message: error.message } as const;
  }

  return { ok: true, message: 'Workspace member removed from cloud.' } as const;
}

export async function upsertSharedListingInCloud(listing: SharedListingRecord) {
  const context = await getCloudWorkspaceContext();
  if (!context.ok) {
    return context;
  }

  const { error } = await context.client.from('shared_listings').upsert(
    {
      workspace_id: context.workspaceId,
      listing_id: listing.id,
      horse_id: listing.horseId,
      share_path: listing.sharePath,
      access_mode: listing.accessMode,
      share_token: listing.shareToken,
      token_issued_at: listing.tokenIssuedAt || new Date().toISOString(),
      published_at: listing.state === 'Live' ? new Date().toISOString() : null,
      state: listing.state,
      channels: listing.channels,
      payload: listing,
      updated_at: listing.updatedAt,
    },
    {
      onConflict: 'workspace_id,listing_id',
    },
  );

  if (error) {
    return { ok: false, message: error.message } as const;
  }

  return { ok: true, message: 'Shared listing saved to cloud.' } as const;
}

export async function updateSharedListingChannelsInCloud(params: {
  horseId: string;
  channel: SharedChannel;
  state?: SharedListingRecord['state'];
}) {
  const context = await getCloudWorkspaceContext();
  if (!context.ok) {
    return context;
  }

  const { data: existing, error: existingError } = await context.client
    .from('shared_listings')
    .select('payload')
    .eq('workspace_id', context.workspaceId)
    .eq('horse_id', params.horseId)
    .not('state', 'eq', 'Archived')
    .maybeSingle();

  if (existingError || !existing?.payload || typeof existing.payload !== 'object') {
    return { ok: false, message: existingError?.message ?? 'Shared listing not found in cloud workspace.' } as const;
  }

  const payload = existing.payload as SharedListingRecord;
  const nextListing: SharedListingRecord = {
    ...payload,
    channels: payload.channels.includes(params.channel) ? payload.channels : [...payload.channels, params.channel],
    state: params.state ?? (payload.state === 'Draft' ? 'Live' : payload.state),
    lastSharedAt: todayStamp(),
    updatedAt: todayStamp(),
  };

  return upsertSharedListingInCloud(nextListing);
}

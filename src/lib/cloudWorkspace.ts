import { apiConfig, isRelationalCloudEnabled, isSnapshotFallbackEnabled, supabaseConfig } from '@/lib/platformConfig';
import { publicShareEventToBuyerRoomEvent, type PublicShareEventRow } from '@/lib/buyerDealRoom';
import { createId, todayStamp } from '@/lib/xbarRuntime';
import { getSupabaseClient } from '@/lib/supabaseClient';
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

type RelationalMirrorResult = {
  ok: boolean;
  message: string;
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

  const acceptedAt = new Date().toISOString();
  const payload =
    invitation.payload && typeof invitation.payload === 'object'
      ? {
          ...(invitation.payload as Record<string, unknown>),
          status: 'Accepted',
          acceptedAt,
        }
      : {
          id: invitation.invitation_id,
          email: normalizedEmail,
          role: invitation.role,
          status: 'Accepted',
          acceptedAt,
        };

  const role = normalizeWorkspaceRole(invitation.role) ?? 'Owner';
  const { error: membershipError } = await client.from('workspace_memberships').upsert(
    {
      workspace_id: invitation.workspace_id,
      user_id: session.user.id,
      email: normalizedEmail,
      display_name: session.user.user_metadata?.full_name ?? session.user.user_metadata?.name ?? normalizedEmail,
      role,
      status: 'active',
      payload: {
        id: `member-${normalizedEmail}`,
        email: normalizedEmail,
        role,
        status: 'Active',
        joinedAt: acceptedAt,
        source: 'Invite',
      },
      updated_at: acceptedAt,
    },
    { onConflict: 'workspace_id,email' },
  );

  if (membershipError) {
    return null;
  }

  const { error: invitationUpdateError } = await client
    .from('workspace_invitations')
    .update({
      status: 'accepted',
      payload,
      updated_at: acceptedAt,
    })
    .eq('workspace_id', invitation.workspace_id)
    .eq('invitation_id', invitation.invitation_id);

  if (invitationUpdateError) {
    return null;
  }

  return {
    workspaceId: invitation.workspace_id as string,
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
    const response = await fetch(`${base}/api/buyer-responses`, {
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

  const workspaceId = workspaceRow.id as string;

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
    | 'shared_listings'
    | 'workspace_invitations';
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

async function syncWorkspaceMembershipRows(params: {
  workspaceId: string;
  session: Session;
  members: WorkspaceMemberRecord[];
  updatedAt: string;
}) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase is not configured for this build.');
  }

  const { workspaceId, session, members, updatedAt } = params;
  const normalizedMembers = members.filter((member) => Boolean(member.email));
  const nextEmails = new Set(normalizedMembers.map((member) => normalizeWorkspaceEmail(member.email)));

  const { data: existingRows, error: existingError } = await client
    .from('workspace_memberships')
    .select('email')
    .eq('workspace_id', workspaceId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const staleEmails = ((existingRows ?? []) as Array<{ email?: string | null }>)
    .map((row) => normalizeWorkspaceEmail(row.email))
    .filter((email) => email && !nextEmails.has(email));

  if (staleEmails.length) {
    const { error: deleteError } = await client
      .from('workspace_memberships')
      .delete()
      .eq('workspace_id', workspaceId)
      .in('email', staleEmails);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  if (!normalizedMembers.length) {
    return;
  }

  const rows = normalizedMembers.map((member) => {
    const normalizedEmail = normalizeWorkspaceEmail(member.email);
    return {
      workspace_id: workspaceId,
      user_id: normalizedEmail === normalizeWorkspaceEmail(session.user.email) ? session.user.id : null,
      email: normalizedEmail,
      display_name: normalizedEmail.split('@')[0] ?? normalizedEmail,
      role: member.role,
      status: member.status === 'Active' ? 'active' : 'inactive',
      payload: member,
      updated_at: updatedAt,
    };
  });

  const { error: upsertError } = await client.from('workspace_memberships').upsert(rows, {
    onConflict: 'workspace_id,email',
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

  try {
    const workspaceId = await ensurePrimaryWorkspace(session, normalized);
    const updatedAt = normalized.exportedAt ?? new Date().toISOString();
    const workspace = normalized.workspace ?? {};

    await syncWorkspaceMembershipRows({
      workspaceId,
      session,
      members: workspace.workspaceMembers ?? [],
      updatedAt,
    });

    await replaceWorkspaceRows({
      table: 'workspace_invitations',
      idColumn: 'invitation_id',
      workspaceId,
      rows: (workspace.workspaceInvitations ?? []).map((invitation) => ({
        workspace_id: workspaceId,
        invitation_id: invitation.id,
        email: normalizeWorkspaceEmail(invitation.email),
        role: invitation.role,
        status: invitation.status.toLowerCase(),
        invited_by_user_id: session.user.id,
        payload: invitation,
        updated_at: updatedAt,
      })),
    });

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
        payload: document,
        updated_at: updatedAt,
      })),
    });

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
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to update the relational workspace.',
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
      .select('payload, updated_at')
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
    version: 8,
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
      subscription: extractPayloadItem<SubscriptionProfile>(subscriptionResult.data),
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

export async function saveWorkspaceBackupToCloud(backup: unknown) {
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
        };
      }

      return {
        ok: true,
        message: 'Cloud sync complete. Relational workspace updated.',
        updatedAt,
      };
    }

    if (!isSnapshotFallbackEnabled()) {
      return {
        ok: false,
        message: relational.message,
        updatedAt,
      };
    }

    const snapshot = await saveWorkspaceSnapshotToCloud(backup, session, updatedAt);
    if (snapshot.ok) {
      return {
        ok: true,
        message: `Relational workspace unavailable. Saved a legacy snapshot instead. ${relational.message}`,
        updatedAt,
      };
    }

    return {
      ok: false,
      message: `${relational.message} ${snapshot.message}`.trim(),
      updatedAt,
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

  const { data } = client.storage.from(supabaseConfig.mediaBucket).getPublicUrl(path);
  return {
    storagePath: path,
    publicUrl: data.publicUrl,
  };
}

export async function uploadDocumentAssetToCloud(params: { file: File; horseId?: string }) {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const session = await getActiveSession();
  if (!session?.user) {
    return null;
  }

  const extension = params.file.name.includes('.') ? params.file.name.split('.').pop() : 'bin';
  const fileName = `${createId('document')}.${extension}`;
  const horseSegment = sanitizeStorageSegment(params.horseId ?? 'unassigned');
  const path = `${session.user.id}/documents/${horseSegment}/${fileName}`;
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

export async function getDocumentAccessUrl(document: Pick<DocumentRecord, 'fileUrl' | 'storagePath'>) {
  const directFileUrl = document.fileUrl?.trim();
  if (directFileUrl) {
    return {
      ok: true,
      url: directFileUrl,
    } as const;
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
    return {
      ok: false,
      message: error?.message ?? 'Unable to generate a secure file link for this document.',
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

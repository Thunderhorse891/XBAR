import { isRelationalCloudMirrorEnabled, supabaseConfig } from '@/lib/platformConfig';
import { createId } from '@/lib/xbarRuntime';
import { getSupabaseClient } from '@/lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import type {
  DocumentRecord,
  HorseRecord,
  IntakeBatch,
  OwnershipRecord,
  RanchAsset,
  SalesLead,
  SharedListingRecord,
  SubscriptionProfile,
  UserRole,
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
    ranchAssets?: RanchAsset[];
    subscription?: SubscriptionProfile;
    salesLeads?: SalesLead[];
    sharedListings?: SharedListingRecord[];
    workspaceProfile?: WorkspaceProfile;
  };
};

type RelationalMirrorResult = {
  ok: boolean;
  message: string;
};

const userRoles: UserRole[] = ['Admin', 'Ranch Manager', 'Owner', 'Medical Lead', 'Sales Lead'];

function sanitizeStorageSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'record';
}

function normalizeWorkspaceRole(value: unknown): UserRole | null {
  return typeof value === 'string' && userRoles.includes(value as UserRole) ? (value as UserRole) : null;
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
      role: membershipRole,
      status: 'active',
      updated_at: updatedAt,
    },
    { onConflict: 'workspace_id,user_id' },
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

async function mirrorWorkspaceBackupToRelationalCloud(backup: unknown, session: Session): Promise<RelationalMirrorResult> {
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
        state: listing.state,
        channels: listing.channels,
        payload: listing,
        updated_at: updatedAt,
      })),
    });

    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase is not configured for this build.');
    }

    const { error: subscriptionError } = await client.from('workspace_subscription_profiles').upsert(
      {
        workspace_id: workspaceId,
        tier: workspace.subscription?.tier ?? 'Starter',
        billing_state: workspace.subscription?.billingState ?? 'Manual Billing',
        monthly_rate: workspace.subscription?.monthlyRate ?? 0,
        payload: workspace.subscription ?? {},
        updated_at: updatedAt,
      },
      { onConflict: 'workspace_id' },
    );

    if (subscriptionError) {
      throw new Error(subscriptionError.message);
    }

    return {
      ok: true,
      message: 'Relational mirror updated.',
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to update the relational cloud mirror.',
    };
  }
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
    return { ok: false, message: error.message };
  }

  if (isRelationalCloudMirrorEnabled()) {
    const mirror = await mirrorWorkspaceBackupToRelationalCloud(backup, session);
    if (!mirror.ok) {
      return {
        ok: false,
        message: mirror.message,
        updatedAt,
      };
    }

    return {
      ok: true,
      message: 'Cloud sync complete. Relational mirror updated.',
      updatedAt,
    };
  }

  return { ok: true, message: 'Cloud sync complete.', updatedAt };
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
    return { ok: false, message: 'No cloud snapshot has been saved for this account yet.' } as const;
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

  const { data, error } = await client.storage.from(supabaseConfig.documentBucket).createSignedUrl(document.storagePath, 60 * 5);
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

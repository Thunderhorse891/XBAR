import { supabaseConfig } from '@/lib/platformConfig';
import { createId } from '@/lib/xbarRuntime';
import { getSupabaseClient } from '@/lib/supabaseClient';

function sanitizeStorageSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'record';
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


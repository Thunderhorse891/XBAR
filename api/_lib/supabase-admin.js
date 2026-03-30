import { createClient } from '@supabase/supabase-js';

let supabaseAdmin = null;

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !serviceRoleKey) {
    return null;
  }

  if (!supabaseAdmin) {
    supabaseAdmin = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabaseAdmin;
}

export async function requireWorkspaceAccess(accessToken, workspaceId) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return {
      ok: false,
      status: 503,
      message: 'Supabase admin credentials are not configured.',
    };
  }

  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      message: 'Missing workspace access token.',
    };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return {
      ok: false,
      status: 401,
      message: userError?.message || 'Unable to verify the signed-in user.',
    };
  }

  const userId = userData.user.id;
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, owner_user_id')
    .eq('id', workspaceId)
    .maybeSingle();

  if (!workspace?.id) {
    return {
      ok: false,
      status: 404,
      message: 'Workspace not found.',
    };
  }

  if (workspace.owner_user_id === userId) {
    return {
      ok: true,
      supabase,
      workspaceId,
      user: userData.user,
      role: 'Admin',
    };
  }

  const { data: membership } = await supabase
    .from('workspace_memberships')
    .select('role, status')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (!membership?.role) {
    return {
      ok: false,
      status: 403,
      message: 'This user does not have access to the requested workspace.',
    };
  }

  return {
    ok: true,
    supabase,
    workspaceId,
    user: userData.user,
    role: membership.role,
  };
}

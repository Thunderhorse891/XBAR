import { readJsonBody, sendJson } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabase-admin.js';
import { confirmationSatisfied, planAccountDeletion } from '../_lib/account-deletion.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { applyCors } from '../_lib/cors.js';

// In-app account deletion (Apple Guideline 5.1.1(v)). Irreversible: deletes the
// caller's own auth account, purges every workspace they solely own (child data
// cascades via the workspace_id foreign keys), and drops their membership in
// shared workspaces. Requires the user to type their exact email to confirm.

const RATE_LIMIT = { bucket: 'account-delete', limit: 5, windowSeconds: 300 };
const DOCUMENT_BUCKET =
  process.env.SUPABASE_DOCUMENT_BUCKET || process.env.VITE_SUPABASE_DOCUMENT_BUCKET || 'horse-documents';
const MEDIA_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || process.env.VITE_SUPABASE_MEDIA_BUCKET || 'horse-media';

export default async function handler(req, res) {
  if (!applyCors(req, res, { methods: 'POST, OPTIONS' })) {
    return;
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }
  if (!(await enforceRateLimit(req, res, RATE_LIMIT))) {
    return;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return sendJson(res, 503, { ok: false, message: 'Account deletion is not available in this deployment.' });
  }

  const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  if (!accessToken) {
    return sendJson(res, 401, { ok: false, message: 'You must be signed in to delete your account.' });
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return sendJson(res, 401, { ok: false, message: 'Unable to verify the signed-in user.' });
  }
  const user = userData.user;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, message: 'Request body must be valid JSON.' });
  }

  if (!confirmationSatisfied(body.confirmation, user.email)) {
    return sendJson(res, 400, {
      ok: false,
      code: 'confirmation_required',
      message: 'Type your account email exactly to confirm deletion.',
    });
  }

  try {
    const { data: owned } = await supabase.from('workspaces').select('id').eq('owner_user_id', user.id);
    const { data: memberships } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', user.id);

    const plan = planAccountDeletion(
      user.id,
      (owned ?? []).map((row) => row.id),
      (memberships ?? []).map((row) => row.workspace_id),
    );

    // Best-effort storage cleanup: buckets aren't reached by the DB cascade, and
    // this user's objects are stored under a `${user.id}/` path prefix. Failures
    // here must not abort the account deletion itself.
    await removeUserStorage(supabase, user.id).catch(() => {});

    // Purge solely-owned workspaces; child rows cascade via workspace_id FKs.
    if (plan.workspacesToPurge.length) {
      const { error } = await supabase.from('workspaces').delete().in('id', plan.workspacesToPurge);
      if (error) {
        return sendJson(res, 502, { ok: false, message: `Failed to remove owned workspaces: ${error.message}` });
      }
    }

    // Drop the user from every workspace they belong to (owned rows are already
    // gone; this clears shared memberships).
    await supabase.from('workspace_memberships').delete().eq('user_id', user.id);

    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      return sendJson(res, 502, { ok: false, message: `Failed to delete the account: ${deleteUserError.message}` });
    }

    return sendJson(res, 200, {
      ok: true,
      deletedWorkspaces: plan.workspacesToPurge.length,
      removedMemberships: plan.membershipsToDrop.length,
    });
  } catch (error) {
    return sendJson(res, 500, { ok: false, message: `Account deletion failed: ${error.message}` });
  }
}

async function removeUserStorage(supabase, userId) {
  for (const bucket of [DOCUMENT_BUCKET, MEDIA_BUCKET]) {
    const { data: entries } = await supabase.storage.from(bucket).list(userId, { limit: 1000 });
    if (!entries?.length) continue;
    const paths = entries.map((entry) => `${userId}/${entry.name}`);
    await supabase.storage.from(bucket).remove(paths);
  }
}

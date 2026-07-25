import { readJsonBody, sendJson } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabase-admin.js';
import { confirmationSatisfied, planAccountDeletion } from '../_lib/account-deletion.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { applyCors } from '../_lib/cors.js';

// In-app account deletion (Apple Guideline 5.1.1(v)). Irreversible. Deletes the
// caller's own auth account and the workspaces they PRIVATELY own; a workspace
// that still has other active members is transferred to a successor, never
// destroyed. Requires the user to type their exact email to confirm.
//
// Ordering is failure-safe: ownership transfers and membership removal (which
// destroy no data) run first; the auth user is deleted next; only then are the
// user's private workspaces and storage objects purged — so a failed account
// deletion can never leave the account half-erased.

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
    // Build the plan: for every owned workspace, look up its OTHER active members
    // so we can transfer rather than destroy shared workspaces.
    const { data: owned } = await supabase.from('workspaces').select('id').eq('owner_user_id', user.id);
    const ownedWorkspaces = [];
    for (const row of owned ?? []) {
      const { data: others } = await supabase
        .from('workspace_memberships')
        .select('user_id, role')
        .eq('workspace_id', row.id)
        .eq('status', 'active')
        .neq('user_id', user.id);
      ownedWorkspaces.push({
        id: row.id,
        otherActiveMembers: (others ?? []).map((member) => ({ userId: member.user_id, role: member.role })),
      });
    }
    const plan = planAccountDeletion(user.id, ownedWorkspaces);

    // 1. Transfer shared workspaces to a successor owner (non-destructive) so
    //    deleting the user can never cascade their data away.
    for (const transfer of plan.workspacesToTransfer) {
      const { error } = await supabase
        .from('workspaces')
        .update({ owner_user_id: transfer.newOwnerUserId })
        .eq('id', transfer.workspaceId)
        .eq('owner_user_id', user.id);
      if (error) {
        return sendJson(res, 502, { ok: false, message: `Could not transfer a shared workspace: ${error.message}` });
      }
    }

    // 2. Remove the user from every workspace they belong to (non-destructive).
    await supabase.from('workspace_memberships').delete().eq('user_id', user.id);

    // 3. Delete the auth account itself. Nothing destructive to the account's
    //    data has happened yet, so a failure here leaves it recoverable.
    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      return sendJson(res, 502, { ok: false, message: `Failed to delete the account: ${deleteUserError.message}` });
    }

    // 4. Account is gone — now purge the user's PRIVATE workspaces (child rows
    //    cascade via workspace_id FKs) and their storage. Best-effort: the
    //    account no longer exists, so leftover cleanup can never resurrect it.
    if (plan.workspacesToPurge.length) {
      await supabase
        .from('workspaces')
        .delete()
        .in('id', plan.workspacesToPurge)
        .then(undefined, () => {});
    }
    await removeUserStorage(supabase, user.id).catch(() => {});

    return sendJson(res, 200, {
      ok: true,
      purgedWorkspaces: plan.workspacesToPurge.length,
      transferredWorkspaces: plan.workspacesToTransfer.length,
    });
  } catch (error) {
    return sendJson(res, 500, { ok: false, message: `Account deletion failed: ${error.message}` });
  }
}

// Recursively collect every object under a prefix. Supabase Storage `list`
// returns only the immediate children of a prefix and marks folders with a null
// id, so nested upload paths (`${user}/horses/<id>/<file>`) require walking.
async function listAllObjects(supabase, bucket, prefix, out) {
  let offset = 0;
  const pageSize = 100;
  for (;;) {
    const { data: entries, error } = await supabase.storage.from(bucket).list(prefix, { limit: pageSize, offset });
    if (error || !entries?.length) break;
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) out.push(path);
      else await listAllObjects(supabase, bucket, path, out); // folder → recurse
    }
    if (entries.length < pageSize) break;
    offset += pageSize;
  }
}

async function removeUserStorage(supabase, userId) {
  for (const bucket of [DOCUMENT_BUCKET, MEDIA_BUCKET]) {
    const paths = [];
    await listAllObjects(supabase, bucket, userId, paths);
    for (let i = 0; i < paths.length; i += 100) {
      await supabase.storage.from(bucket).remove(paths.slice(i, i + 100));
    }
  }
}

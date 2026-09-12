import { readJsonBody, sendJson } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabase-admin.js';
import {
  confirmationSatisfied,
  documentPrefixesToPurge,
  loadAccountDeletionPlan,
  mediaPrefixesToPurge,
} from '../_lib/account-deletion.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';
import { applyCors } from '../_lib/cors.js';

// In-app account deletion. Irreversible. Deletes the
// caller's own auth account and the workspaces they PRIVATELY own. Accounts
// owning shared workspaces require a reviewed handoff before deletion: changing
// a workspace owner alone does not transfer its stored files or their access.
// Requires the user to type their exact email to confirm.
//
// Prerequisite checks precede membership removal and auth deletion. File cleanup
// follows auth deletion. This ordering does not make the multi-request operation
// transactional; concurrency and shared-file lifecycle remain separate checks.

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
    // so a shared workspace cannot be mistaken for private data to purge.
    const plan = await loadAccountDeletionPlan(supabase, user.id);

    // Transferring the row then deleting the entire user's Storage prefix
    // destroyed shared files. Refuse before any mutation until the handoff
    // includes verified file retention and successor access.
    if (plan.workspacesToTransfer.length) {
      return sendJson(res, 409, {
        ok: false,
        code: 'shared_workspace_handoff_required',
        message:
          'Your account owns a workspace with other members. Shared records and files need a reviewed ownership handoff before this account can be deleted. Nothing was changed.',
      });
    }

    // 2. Remove the user from every workspace they belong to (non-destructive).
    const { error: membershipRemovalError } = await supabase
      .from('workspace_memberships')
      .delete()
      .eq('user_id', user.id);
    if (membershipRemovalError) {
      return sendJson(res, 502, { ok: false, message: 'Unable to remove workspace access. Account was not deleted.' });
    }

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
    // Documents moved onto workspace-keyed paths, so sweeping only the
    // departing user's own prefix would leave every file in a purged private
    // workspace sitting in the bucket after this endpoint reported success --
    // while the Settings screen promises those documents were erased. Which
    // prefixes are safe to sweep is decided in account-deletion.js, where the
    // rule that a transferred workspace is never swept can be tested.
    await removeStoragePrefixes(supabase, DOCUMENT_BUCKET, documentPrefixesToPurge(plan)).catch(() => {});
    await removeStoragePrefixes(supabase, MEDIA_BUCKET, mediaPrefixesToPurge(plan)).catch(() => {});

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

async function removeStoragePrefixes(supabase, bucket, prefixes) {
  for (const prefix of prefixes) {
    const paths = [];
    await listAllObjects(supabase, bucket, prefix, paths);
    for (let i = 0; i < paths.length; i += 100) {
      await supabase.storage.from(bucket).remove(paths.slice(i, i + 100));
    }
  }
}

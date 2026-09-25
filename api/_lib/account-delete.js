import { readJsonBody, sendJson } from './http.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import {
  confirmationSatisfied,
  documentPrefixesToPurge,
  loadAccountDeletionPlan,
  mediaPrefixesToPurge,
  workspacesStillPrivate,
} from './account-deletion.js';
import { enforceRateLimit } from './rate-limit.js';
import { applyCors } from './cors.js';
import { randomUUID } from 'node:crypto';
import { recordDeletionAudit } from './deletion-audit.js';

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

  let auditEvent;
  let auditStarted = false;
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

    /*
     * Re-read membership BEFORE anything is mutated.
     *
     * An earlier version of this ran the same query after
     * `auth.admin.deleteUser`, which made it worse than useless.
     * `production-schema.sql` declares `workspaces.owner_user_id ... on delete
     * cascade` and `workspace_memberships.workspace_id ... on delete cascade`,
     * so deleting the auth user destroys the owned workspaces AND their
     * membership rows first. The re-check then read an empty table, concluded
     * that nothing was shared, and marked EVERY planned workspace purgeable --
     * a guard that could only ever widen the purge, reading as protection.
     *
     * Asked here, the query sees live rows. The user's own membership is
     * excluded in JS rather than with `.neq`, because `user_id` is nullable and
     * SQL would silently drop a NULL row: an active membership belonging to
     * nobody identifiable is evidence of sharing, not of privacy.
     */
    let purgeable = plan.workspacesToPurge;
    if (plan.workspacesToPurge.length) {
      const { data: liveMemberships, error: recheckError } = await supabase
        .from('workspace_memberships')
        .select('workspace_id, user_id')
        .in('workspace_id', plan.workspacesToPurge)
        .eq('status', 'active');

      // Unreadable membership is never evidence that a workspace is private.
      if (recheckError) {
        return sendJson(res, 502, {
          ok: false,
          message: 'Unable to confirm who still has access to your workspaces. Nothing was changed.',
        });
      }

      const otherMembers = (liveMemberships ?? []).filter((row) => row?.user_id !== user.id);
      purgeable = workspacesStillPrivate(plan.workspacesToPurge, otherMembers);

      /*
       * A workspace that gained a member since the plan was built cannot be
       * kept while this account is deleted: the owner FK cascades, so deleting
       * the user destroys that workspace whatever this endpoint does about
       * storage. Refusing is the only outcome that does not take someone
       * else's records with it, and it matches what a workspace shared at plan
       * time already gets.
       */
      if (purgeable.length !== plan.workspacesToPurge.length) {
        return sendJson(res, 409, {
          ok: false,
          code: 'shared_workspace_handoff_required',
          message:
            'Someone was given access to one of your workspaces while this request was being prepared. Shared records and files need a reviewed ownership handoff before this account can be deleted. Nothing was changed.',
        });
      }
    }

    auditEvent = { operation_id: randomUUID(), actor_user_id: user.id, workspace_ids: purgeable };
    try {
      await recordDeletionAudit(supabase, { ...auditEvent, phase: 'started' });
      auditStarted = true;
    } catch {
      return sendJson(res, 503, {
        ok: false,
        code: 'deletion_audit_unavailable',
        message: 'Deletion could not be recorded. Nothing was deleted. Please try again later.',
      });
    }

    // 2. Remove the user from every workspace they belong to (non-destructive).
    const { error: membershipRemovalError } = await supabase
      .from('workspace_memberships')
      .delete()
      .eq('user_id', user.id);
    if (membershipRemovalError) {
      throw new Error('membership_removal_failed');
    }

    // 3. Delete the auth account itself. Nothing destructive to the account's
    //    data has happened yet, so a failure here leaves it recoverable.
    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      throw new Error('auth_deletion_failed');
    }

    /*
     * 4. Account is gone — now purge the workspaces confirmed private above.
     *
     * The owner FK has already cascaded these rows away; the delete below is
     * kept because it is the statement that expresses the intent, and it is
     * harmless when the rows are already gone. Storage is NOT cascaded by
     * anything, which is the part that genuinely still has to run here.
     */
    if (purgeable.length) {
      const { error: cleanupError } = await supabase.from('workspaces').delete().in('id', purgeable);
      if (cleanupError) throw new Error('workspace_cleanup_failed');
    }
    // Documents moved onto workspace-keyed paths, so sweeping only the
    // departing user's own prefix would leave every file in a purged private
    // workspace sitting in the bucket after this endpoint reported success --
    // while the Settings screen promises those documents were erased. Which
    // prefixes are safe to sweep is decided in account-deletion.js, where the
    // rule that a transferred workspace is never swept can be tested.
    await removeStoragePrefixes(
      supabase,
      DOCUMENT_BUCKET,
      documentPrefixesToPurge({ ...plan, workspacesToPurge: purgeable }),
    );
    await removeStoragePrefixes(
      supabase,
      MEDIA_BUCKET,
      mediaPrefixesToPurge({ ...plan, workspacesToPurge: purgeable }),
    );

    await recordDeletionAudit(supabase, { ...auditEvent, phase: 'completed' });

    return sendJson(res, 200, {
      ok: true,
      purgedWorkspaces: purgeable.length,
      transferredWorkspaces: plan.workspacesToTransfer.length,
    });
  } catch {
    let auditFailed = false;
    if (auditStarted) {
      try {
        await recordDeletionAudit(supabase, { ...auditEvent, phase: 'failed' });
      } catch {
        auditFailed = true;
        console.error('Account deletion outcome audit unavailable', auditEvent.operation_id);
      }
    }
    return sendJson(res, auditFailed ? 503 : 502, {
      ok: false,
      code: auditFailed ? 'deletion_audit_incomplete' : 'deletion_incomplete',
      operationId: auditEvent?.operation_id,
      message:
        'Account deletion could not be fully confirmed. Some steps may have completed. Contact support with this operation ID before retrying.',
    });
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
    if (error) throw new Error('storage_list_failed');
    if (!entries?.length) break;
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
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw new Error('storage_remove_failed');
    }
  }
}

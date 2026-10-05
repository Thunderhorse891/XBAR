import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { claimCheckoutLock, renewCheckoutLock, releaseCheckoutLock } from './checkout-session.js';
import { BILLING_UNVERIFIED, verifyAccountDeletionBilling } from './account-deletion-billing.js';
import { readJsonBody, sendJson } from './http.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import {
  confirmationSatisfied,
  documentPrefixesToPurge,
  loadAccountDeletionPlan,
  mediaPrefixesToPurge,
  packetPrefixesToPurge,
  heldWorkspaceIds,
  pathsStillReferenced,
} from './account-deletion.js';
import { enforceRateLimit } from './rate-limit.js';
import { applyCors } from './cors.js';

// In-app account deletion. Irreversible. Deletes the
// caller's own auth account and the workspaces they PRIVATELY own. Accounts
// owning shared workspaces require a reviewed handoff before deletion: changing
// a workspace owner alone does not transfer its stored files or their access.
// Requires the user to type their exact email to confirm.
//
// Order: plan (read) -> database hold on every owned workspace (refuses if any
// is shared, and blocks new members until the delete) -> durable receipt ->
// auth delete (memberships cascade with it) -> storage sweep -> receipt
// outcome. Any failure before the auth delete releases the holds and changes
// nothing.

const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim() || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2026-02-25.clover' }) : null;

const RATE_LIMIT = { bucket: 'account-delete', limit: 5, windowSeconds: 300 };
const DOCUMENT_BUCKET =
  process.env.SUPABASE_DOCUMENT_BUCKET || process.env.VITE_SUPABASE_DOCUMENT_BUCKET || 'horse-documents';
const MEDIA_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || process.env.VITE_SUPABASE_MEDIA_BUCKET || 'horse-media';
const PACKET_BUCKET = process.env.SUPABASE_SALE_PACKET_BUCKET || 'sale-packets';

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

  const billingClaims = [];
  const deletionToken = randomUUID();
  let releaseHolds = null;
  let accountDeleted = false;
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

    // Serialize deletion with checkout AND other deletion requests before
    // touching membership holds. A losing deletion must not replace or release
    // the winning request's per-user hold.
    for (const workspaceId of [...plan.workspacesToPurge].sort()) {
      const token = await claimCheckoutLock(supabase, workspaceId);
      if (!token) return sendJson(res, BILLING_UNVERIFIED.status, BILLING_UNVERIFIED);
      billingClaims.push({ workspaceId, token });
    }

    /*
     * Hold every owned workspace at the database before anything irreversible.
     *
     * The plan above is a read; between it and `deleteUser`, an invitation
     * could be accepted, and the owner foreign key would then cascade the
     * account delete into a workspace that had just become shared -- taking a
     * new member's access and records with it. Re-reading membership here
     * only narrowed that window (audit F03).
     *
     * `xbar_hold_account_deletion_request` closes it. Under the same
     * per-workspace lock the seat trigger takes, it re-checks every owned
     * workspace for another active member (a NULL user_id counts as one) and,
     * only if all are private, records a hold that makes the database refuse
     * any new member or invitation. An acceptance and this hold now serialize:
     * either the member is in first and deletion is refused, or the hold is in
     * first and the acceptance is refused with a reason. The held set it
     * returns is the authoritative list to purge.
     *
     * Unreadable is never private: any error refuses and changes nothing.
     */
    const { data: hold, error: holdError } = await supabase.rpc('xbar_hold_account_deletion_request', {
      p_user_id: user.id,
      p_request_token: deletionToken,
    });
    if (holdError || !hold || typeof hold.ok !== 'boolean') {
      if (holdError) console.error('account deletion: hold failed', { userId: user.id, message: holdError.message });
      return sendJson(res, 502, {
        ok: false,
        message: 'Unable to confirm who still has access to your workspaces. Nothing was changed.',
      });
    }
    if (!hold.ok) {
      if (hold.reason === 'deletion_in_progress') return sendJson(res, BILLING_UNVERIFIED.status, BILLING_UNVERIFIED);
      return sendJson(res, 409, {
        ok: false,
        code: 'shared_workspace_handoff_required',
        message:
          'Someone was given access to one of your workspaces while this request was being prepared. Shared records and files need a reviewed ownership handoff before this account can be deleted. Nothing was changed.',
      });
    }
    const purgeable = heldWorkspaceIds(hold);
    releaseHolds = () =>
      supabase
        .rpc('xbar_release_account_deletion_request', { p_user_id: user.id, p_request_token: deletionToken })
        .then(
          ({ error }) => {
            if (error)
              console.error('account deletion: holds not released', { userId: user.id, message: error.message });
          },
          (error) => console.error('account deletion: holds not released', { userId: user.id, message: String(error) }),
        );

    // Ownership changing between planning and the hold cannot expand deletion
    // beyond the workspaces whose checkout leases this request actually owns.
    if (
      purgeable.length !== billingClaims.length ||
      purgeable.some((workspaceId) => !billingClaims.some((claim) => claim.workspaceId === workspaceId))
    ) {
      return sendJson(res, BILLING_UNVERIFIED.status, BILLING_UNVERIFIED);
    }
    // Check even while managed checkout is disabled: older Stripe subscriptions
    // and cached payment pages can still exist.
    for (const { workspaceId } of billingClaims) {
      const billing = await verifyAccountDeletionBilling(supabase, workspaceId, stripe);
      if (!billing.ok) return sendJson(res, billing.status, billing);
    }

    /*
     * The receipt outlives the account (no foreign key), so what was deleted
     * and any cleanup that did not finish stay on record. Without it, a
     * failure after the account is gone has nowhere to be written.
     */
    const { data: receipt, error: receiptError } = await supabase
      .from('account_deletion_receipts')
      .insert({ user_id: user.id, held_workspaces: purgeable })
      .select('id')
      .single();
    if (receiptError || !receipt?.id) {
      return sendJson(res, 502, { ok: false, message: 'Unable to start account deletion. Nothing was changed.' });
    }
    const finishReceipt = (fields) =>
      supabase
        .from('account_deletion_receipts')
        .update({ ...fields, finished_at: new Date().toISOString() })
        .eq('id', receipt.id)
        .then(
          ({ error }) => {
            if (error) console.error('account deletion: receipt not updated', { receiptId: receipt.id, fields });
          },
          () => console.error('account deletion: receipt not updated', { receiptId: receipt.id, fields }),
        );

    /*
     * Files under the account's own legacy prefix that another workspace still
     * points at are not this account's to erase: they back a surviving
     * ranch's records. Read before the delete, and refused if unreadable --
     * guessing would either erase someone else's documents or keep files the
     * deletion promised to remove.
     */
    const { data: sharedRefs, error: sharedRefsError } = await supabase
      .from('documents')
      .select('workspace_id, storage_path')
      .like('storage_path', `${user.id}/%`);
    if (sharedRefsError || !Array.isArray(sharedRefs)) {
      await finishReceipt({ status: 'refused', failure: 'shared file references unreadable' });
      return sendJson(res, 502, {
        ok: false,
        message: 'Unable to confirm which stored files are still shared. Nothing was changed.',
      });
    }
    const protectedPaths = pathsStillReferenced(sharedRefs, purgeable);

    /*
     * Delete the account. Its memberships go with it (the user_id foreign key
     * cascades), so nothing is removed beforehand: a failure here used to
     * leave the person still signed up but already locked out of every other
     * owner's ranch. Now a failure releases the holds and changes nothing.
     */
    // Slow reads must not outlive the checkout fence. A lost lease preserves
    // the account instead of deleting it beside a newly admitted purchase.
    for (const { workspaceId, token } of billingClaims) {
      if (!(await renewCheckoutLock(supabase, workspaceId, token))) {
        await finishReceipt({ status: 'refused', failure: 'billing lease lost' });
        return sendJson(res, BILLING_UNVERIFIED.status, BILLING_UNVERIFIED);
      }
    }
    const { data: confirmed, error: confirmError } = await supabase.rpc('xbar_confirm_account_deletion_request', {
      p_user_id: user.id,
      p_request_token: deletionToken,
      p_workspace_ids: purgeable,
    });
    if (confirmError || confirmed !== true) {
      await finishReceipt({ status: 'refused', failure: 'deletion request fence lost' });
      return sendJson(res, BILLING_UNVERIFIED.status, BILLING_UNVERIFIED);
    }
    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      console.error('account deletion: auth delete failed', { userId: user.id, message: deleteUserError.message });
      await finishReceipt({ status: 'failed', failure: 'auth delete failed' });
      return sendJson(res, 502, {
        ok: false,
        message: 'Your account could not be deleted. Nothing was removed; try again.',
      });
    }

    accountDeleted = true;

    /*
     * Account is gone -- now purge the workspaces that were held.
     *
     * The owner FK has already cascaded these rows away; the delete below is
     * kept because it is the statement that expresses the intent, and it is
     * harmless when the rows are already gone. Storage is NOT cascaded by
     * anything, which is the part that genuinely still has to run here.
     */
    if (purgeable.length) {
      await supabase
        .from('workspaces')
        .delete()
        .in('id', purgeable)
        .then(undefined, () => {});
    }
    /*
     * Each sweep reports what it could not finish rather than swallowing it.
     * The account is already gone, so there is nothing to roll back -- but a
     * response that says "erased" while packet PDFs full of Coggins and
     * registration copies are still in the bucket is the silent success this
     * codebase keeps paying for. The receipt records it so it can be finished.
     */
    const purge = { ...plan, workspacesToPurge: purgeable };
    const leftovers = [];
    for (const [bucket, prefixes] of [
      [DOCUMENT_BUCKET, documentPrefixesToPurge(purge)],
      [MEDIA_BUCKET, mediaPrefixesToPurge(purge)],
      [PACKET_BUCKET, packetPrefixesToPurge(purge)],
    ]) {
      const failed = await removeStoragePrefixes(supabase, bucket, prefixes, protectedPaths).catch(() => prefixes);
      if (failed.length) leftovers.push({ bucket, prefixes: failed });
    }
    if (leftovers.length) {
      console.error('account deletion: stored files could not all be removed', { userId: user.id, leftovers });
    }
    await finishReceipt({
      status: leftovers.length ? 'storage_incomplete' : 'complete',
      storage_leftovers: leftovers,
    });

    return sendJson(res, 200, {
      ok: true,
      purgedWorkspaces: purgeable.length,
      transferredWorkspaces: plan.workspacesToTransfer.length,
      storageCleanupComplete: leftovers.length === 0,
    });
  } catch (error) {
    return sendJson(res, 500, { ok: false, message: `Account deletion failed: ${error.message}` });
  } finally {
    if (!accountDeleted && releaseHolds) await releaseHolds();
    for (const { workspaceId, token } of billingClaims) {
      await releaseCheckoutLock(supabase, workspaceId, token);
    }
  }
}

// Recursively collect every object under a prefix. Supabase Storage `list`
// returns only the immediate children of a prefix and marks folders with a null
// id, so nested upload paths (`${user}/horses/<id>/<file>`) require walking.
// Returns false when a listing failed, so the caller can tell "nothing here"
// from "could not look".
async function listAllObjects(supabase, bucket, prefix, out) {
  let offset = 0;
  const pageSize = 100;
  for (;;) {
    const { data: entries, error } = await supabase.storage.from(bucket).list(prefix, { limit: pageSize, offset });
    if (error || !Array.isArray(entries)) return false;
    if (
      entries.some(
        (entry) =>
          !entry ||
          typeof entry.name !== 'string' ||
          !entry.name ||
          entry.name === '.' ||
          entry.name === '..' ||
          entry.name.includes('/') ||
          entry.name.includes('\\') ||
          (entry.id !== null && (typeof entry.id !== 'string' || !entry.id)),
      )
    )
      return false;
    if (!entries.length) return true;
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) out.push(path);
      else if (!(await listAllObjects(supabase, bucket, path, out))) return false; // folder → recurse
    }
    if (entries.length < pageSize) return true;
    offset += pageSize;
  }
}

// Removes every object under each prefix; returns the prefixes it could not
// fully clear or verify (a listing/removal failed, or eligible objects remain).
export async function removeStoragePrefixes(supabase, bucket, prefixes, keep = new Set()) {
  const failed = [];
  for (const prefix of prefixes) {
    const listed = [];
    let complete = await listAllObjects(supabase, bucket, prefix, listed);
    // Objects another surviving workspace still references are kept.
    const paths = listed.filter((path) => !keep.has(path));
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) complete = false;
    }
    if (complete) {
      // A successful removal response does not prove every object disappeared.
      // Verify once without retrying deletion; retained shared files are allowed.
      const remaining = [];
      complete = await listAllObjects(supabase, bucket, prefix, remaining);
      if (remaining.some((path) => !keep.has(path))) complete = false;
    }
    if (!complete) failed.push(prefix);
  }
  return failed;
}

// Planning helpers for the destructive account-deletion flow. Kept framework-free
// so the intent/safety decisions are unit-testable without a live Supabase.
//
// Account deletion is irreversible and satisfies Apple Guideline 5.1.1(v)
// (in-app account deletion). The endpoint deletes the caller's own account only,
// after an explicit typed confirmation, and — critically — never destroys a
// workspace that still has other active members: it transfers ownership instead.

/**
 * The user must type their exact email to confirm deletion — a strong,
 * unambiguous intent signal that a stray tap can't produce. Comparison is
 * trimmed and case-insensitive; empty input never matches.
 */
export function confirmationSatisfied(confirmation, email) {
  const typed = String(confirmation ?? '')
    .trim()
    .toLowerCase();
  const actual = String(email ?? '')
    .trim()
    .toLowerCase();
  return typed.length > 0 && actual.length > 0 && typed === actual;
}

// When a departing owner's workspace must be kept for its remaining members,
// hand it to the most capable active member so the workspace stays governable.
const ROLE_PRIORITY = ['Admin', 'Ranch Manager', 'Medical Lead', 'Sales Lead', 'Owner'];

export function pickSuccessorOwner(otherActiveMembers) {
  const members = (otherActiveMembers ?? []).filter((member) => member && member.userId);
  if (members.length === 0) return null;
  const ranked = [...members].sort((a, b) => {
    const ra = ROLE_PRIORITY.indexOf(a.role);
    const rb = ROLE_PRIORITY.indexOf(b.role);
    return (ra === -1 ? ROLE_PRIORITY.length : ra) - (rb === -1 ? ROLE_PRIORITY.length : rb);
  });
  return ranked[0].userId;
}

/**
 * Decide what happens to each workspace the departing user owns:
 *   - no other active members  -> purge it (their private workspace).
 *   - other active members      -> transfer ownership to a successor; never
 *                                  destroy other people's shared data.
 *
 * @param {string} userId
 * @param {{ id: string, otherActiveMembers?: {userId: string, role?: string}[] }[]} ownedWorkspaces
 */
export function planAccountDeletion(userId, ownedWorkspaces) {
  const workspacesToPurge = [];
  const workspacesToTransfer = [];
  for (const workspace of ownedWorkspaces ?? []) {
    if (!workspace?.id) continue;
    const successor = pickSuccessorOwner(workspace.otherActiveMembers);
    if (successor) {
      workspacesToTransfer.push({ workspaceId: workspace.id, newOwnerUserId: successor });
    } else {
      workspacesToPurge.push(workspace.id);
    }
  }
  return { userId, workspacesToPurge, workspacesToTransfer };
}

// Supabase reports database failures in `error`, not just rejected promises.
// An unreadable membership list is never evidence that a workspace is private.
export async function loadAccountDeletionPlan(supabase, userId) {
  const { data: owned, error: ownedError } = await supabase.from('workspaces').select('id').eq('owner_user_id', userId);
  if (ownedError || !Array.isArray(owned))
    throw new Error('Unable to verify owned workspaces. No account deletion was attempted.');
  const workspaces = [];
  for (const row of owned) {
    if (typeof row?.id !== 'string' || !row.id) throw new Error('Invalid workspace ownership result.');
    const { data: others, error: membersError } = await supabase
      .from('workspace_memberships')
      .select('user_id, role')
      .eq('workspace_id', row.id)
      .eq('status', 'active')
      .neq('user_id', userId);
    if (membersError || !Array.isArray(others))
      throw new Error('Unable to verify shared workspace members. No account deletion was attempted.');
    if (others.some((member) => typeof member?.user_id !== 'string' || !member.user_id))
      throw new Error('Invalid shared workspace membership result.');
    workspaces.push({
      id: row.id,
      otherActiveMembers: others.map((member) => ({ userId: member.user_id, role: member.role })),
    });
  }
  return planAccountDeletion(userId, workspaces);
}

/**
 * Which prefixes of the DOCUMENT bucket an account deletion may erase.
 *
 * Two shapes live in that bucket, and both have to go for the promise on the
 * Settings screen -- "permanently erases every workspace you solely own ...
 * documents" -- to be true:
 *
 *   <user-id>/documents/...       objects written before documents were keyed
 *                                 to the workspace
 *   <workspace-id>/documents/...  every object written since
 *
 * Only workspaces being PURGED are included, never one being transferred. That
 * is the whole safety argument, and it is not a judgement call: a workspace is
 * purged exactly when no other active member remains, so a prefix in this list
 * cannot hold anyone else's files. Sweeping a transferred workspace would
 * delete the records of the people who stayed.
 *
 * @param {{ userId: string, workspacesToPurge: string[] }} plan
 */
export function documentPrefixesToPurge(plan) {
  return [plan?.userId, ...(plan?.workspacesToPurge ?? [])].filter(
    (prefix) => typeof prefix === 'string' && prefix.length > 0,
  );
}

/**
 * Which prefixes of the MEDIA bucket an account deletion may erase.
 *
 * Same two shapes as documents: `<user-id>/horses/...` from before photos were
 * keyed to the workspace, and `<workspace-id>/horses/...` for every photo
 * since. The same safety argument applies -- only purged workspaces, which by
 * definition have no other active member, never a transferred one.
 *
 * @param {{ userId: string, workspacesToPurge: string[] }} plan
 */
export function mediaPrefixesToPurge(plan) {
  return documentPrefixesToPurge(plan);
}

/**
 * Which prefixes of the SALE-PACKET bucket an account deletion may erase.
 *
 * Packets are only ever written by the server, as `<workspace-id>/<horse>/...`,
 * and each one embeds full copies of the horse's documents -- so leaving them
 * would keep the Coggins and registration papers the deletion promised to
 * erase. There is no uploader-keyed layout here, so only purged workspaces.
 *
 * @param {{ workspacesToPurge: string[] }} plan
 */
export function packetPrefixesToPurge(plan) {
  return (plan?.workspacesToPurge ?? []).filter((prefix) => typeof prefix === 'string' && prefix.length > 0);
}

/**
 * The workspaces the database agreed to hold, which is the set to purge.
 *
 * Read from the hold RPC's answer, not from the plan: the RPC re-checked each
 * workspace under the seat lock, so it is the authoritative "still private"
 * list. Anything that is not a non-empty string is dropped rather than passed
 * on to a delete or a storage sweep.
 *
 * @param {{ held?: unknown }} hold
 * @returns {string[]}
 */
export function heldWorkspaceIds(hold) {
  const held = Array.isArray(hold?.held) ? hold.held : [];
  return held.filter((id) => typeof id === 'string' && id.length > 0);
}

/**
 * Storage paths under the departing account's own prefix that a SURVIVING
 * workspace's documents still point at.
 *
 * Documents written before files were keyed to the workspace live at
 * `<user-id>/...`. If the account had uploaded into a ranch it did not own,
 * that ranch's records still name those objects, and sweeping the account's
 * prefix would erase another ranch's papers. Rows in a workspace being purged
 * are excluded -- those records are going too.
 *
 * @param {{ workspace_id?: unknown, storage_path?: unknown }[]} rows
 * @param {string[]} purgedWorkspaceIds
 * @returns {Set<string>}
 */
export function pathsStillReferenced(rows, purgedWorkspaceIds) {
  const purged = new Set(purgedWorkspaceIds ?? []);
  const keep = new Set();
  for (const row of rows ?? []) {
    if (typeof row?.storage_path !== 'string' || !row.storage_path) continue;
    if (typeof row.workspace_id === 'string' && purged.has(row.workspace_id)) continue;
    keep.add(row.storage_path);
  }
  return keep;
}

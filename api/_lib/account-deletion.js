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
 * Horse media is still keyed to whoever uploaded it -- `horse-media` is a
 * public bucket, so it never had the shared-read problem that moved documents
 * onto workspace paths -- which makes the departing account's own prefix the
 * only one that applies. A workspace id here would erase nothing today and
 * would be a loaded gun if media ever moved.
 *
 * @param {{ userId: string }} plan
 */
export function mediaPrefixesToPurge(plan) {
  return typeof plan?.userId === 'string' && plan.userId ? [plan.userId] : [];
}

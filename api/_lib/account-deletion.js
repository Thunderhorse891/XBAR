// Pure helpers for the destructive account-deletion flow. Kept framework-free
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

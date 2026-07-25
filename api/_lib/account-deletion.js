// Pure helpers for the destructive account-deletion flow. Kept framework-free
// so the intent/safety checks are unit-testable without a live Supabase.
//
// Account deletion is irreversible and satisfies Apple Guideline 5.1.1(v)
// (in-app account deletion). The endpoint that uses these helpers deletes the
// caller's own account only, and only after an explicit typed confirmation.

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

/**
 * Split the workspaces a user touches into the ones deletion must purge (those
 * they solely own) and the memberships to drop (shared workspaces they only
 * belong to). Sole ownership is decided by workspaces.owner_user_id, so a
 * co-owned or member workspace is never destroyed for other people — the user
 * is simply removed from it.
 */
export function planAccountDeletion(userId, ownedWorkspaceIds, membershipWorkspaceIds) {
  const owned = new Set((ownedWorkspaceIds ?? []).filter(Boolean));
  const workspacesToPurge = [...owned];
  const membershipsToDrop = (membershipWorkspaceIds ?? []).filter((id) => id && !owned.has(id));
  return { userId, workspacesToPurge, membershipsToDrop };
}

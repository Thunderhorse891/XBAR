/*
 * Buyer-facing workspace identity.
 *
 * Quick-start sentinel values that must never be treated as real seller
 * identity. handleQuickStart (src/routes/SetupWorkspace.tsx) invents
 * `My Ranch LLC` (business name), `Main Ranch` (ranch name —
 * applyWorkspaceProfileDefaults also derives defaultOwnerName from it),
 * `Operations Lead` (ranch manager) and `owner@ranch.local` (operations
 * email) so a skipped setup still yields a working ranch. The
 * workspaceSetupDefaults comment documents why the shared path
 * deliberately invents nothing. Presenting an invented company, ranch,
 * person or mailbox as the seller misidentifies them to the buyer, so
 * every buyer-facing surface resolves identity through here.
 *
 * The server has its own copy (api/_lib/workspace-identity.js) because the
 * API routes cannot import from the client bundle; the two lists must stay
 * identical.
 */
const QUICK_START_IDENTITY_SENTINELS = ['my ranch llc', 'main ranch', 'operations lead', 'owner@ranch.local'];

export function isQuickStartSentinel(value: string | null | undefined): boolean {
  return QUICK_START_IDENTITY_SENTINELS.includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

/*
 * A workspace name that is safe to print to a buyer: the real name, or ''
 * when it was never set or is only a quick-start placeholder. A real
 * customer who actually named their ranch "Main Ranch" loses the printed
 * name — an honest absence, and the safer direction.
 */
export function realWorkspaceName(value: string | null | undefined): string {
  const name = String(value ?? '').trim();
  return isQuickStartSentinel(name) ? '' : name;
}

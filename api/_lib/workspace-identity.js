/*
 * Buyer-facing seller identity for server-rendered surfaces.
 *
 * Quick-start sentinel values that must never be treated as real seller
 * identity. handleQuickStart (src/routes/SetupWorkspace.tsx) invents
 * `My Ranch LLC` (business name), `Main Ranch` (ranch name —
 * applyWorkspaceProfileDefaults also derives defaultOwnerName from it),
 * `Operations Lead` and `owner@ranch.local` (operations email) so a skipped
 * setup still yields a working ranch. The local sale packet, share caption
 * and report exports filter the same set (isQuickStartSentinel in
 * src/lib/workspaceIdentity.ts); this is the server copy for buyer-facing
 * sender identity in cloud packets, which cannot import from the client
 * bundle. The two lists must stay identical — tests/api/
 * workspaceIdentityParity.test.mjs fails the build if they drift.
 * Presenting an invented company, ranch or mailbox as the sender
 * misidentifies the seller to the buyer.
 */
const QUICK_START_IDENTITY_SENTINELS = ['my ranch llc', 'main ranch', 'operations lead', 'owner@ranch.local'];

export function isQuickStartSentinel(value) {
  return QUICK_START_IDENTITY_SENTINELS.includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

/*
 * The buyer-facing seller identity, with invented placeholders removed.
 * Returns the real business and ranch names (each '' when unset or a
 * sentinel) and a display string that falls back honestly when neither is
 * real. A real customer who actually named their ranch "Main Ranch" loses
 * the printed name — an honest absence, and the safer direction.
 */
export function sellerIdentity(workspace) {
  const business = isQuickStartSentinel(workspace?.businessName) ? '' : String(workspace?.businessName ?? '').trim();
  const ranch = isQuickStartSentinel(workspace?.ranchName) ? '' : String(workspace?.ranchName ?? '').trim();
  const email = isQuickStartSentinel(workspace?.operationsEmail) ? '' : String(workspace?.operationsEmail ?? '').trim();
  return { business, ranch, email, display: business || ranch || '' };
}

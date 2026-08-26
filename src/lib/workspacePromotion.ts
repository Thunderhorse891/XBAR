// Moving a device's files with the records they belong to.
//
// A signed-out rancher's files are owned by `'local'`. The moment their
// workspace becomes a cloud workspace, every ownership check compares against
// the new owner and refuses those entries — the records still name them, and
// nothing opens, exports or attaches. So the files have to be handed over in
// the same step that promotes the records.
//
// This lives here rather than inside either caller because there are TWO ways
// to promote: CloudBootstrap does it automatically when reconciliation chooses
// the local copy, and Settings' "Push cloud" does it by hand — which is exactly
// what the conflict-lock message tells the rancher to do. One of them adopting
// and the other not is the same defect with a different route in.

import { adoptVaultEntries, referencedVaultKeys } from '@/lib/localFileVault';
import { rememberRecordsOwner } from '@/lib/recordsOwner';

interface PromotableWorkspace {
  documents?: { localFileKey?: string }[];
  expenseReceipts?: { localFileKey?: string }[];
  salePacketBuilds?: { localFileKey?: string }[];
}

/**
 * Hand this device's referenced files to `owner`, and record who owns the
 * records once every one of them has arrived.
 *
 * The records marker is written ONLY on a complete move. A partial move that
 * claimed success would be permanent: reconciliation settles, later loads see
 * the copies agree, and the entries still tagged `'local'` stay refused for as
 * long as the session lasts. Leaving the marker unwritten costs a sweep that
 * does not run and buys a promotion that is retried.
 *
 * @returns what moved, and what did not.
 */
export async function promoteLocalVaultFiles(
  workspace: PromotableWorkspace,
  owner: string,
): Promise<{ adopted: number; failed: string[] }> {
  // Nothing to promote to: still the local workspace.
  if (!owner || owner === 'local') return { adopted: 0, failed: [] };

  const result = await adoptVaultEntries(
    referencedVaultKeys(workspace.documents ?? [], workspace.expenseReceipts ?? [], workspace.salePacketBuilds ?? []),
    'local',
    owner,
  );

  if (result.failed.length === 0) rememberRecordsOwner(owner);

  return result;
}

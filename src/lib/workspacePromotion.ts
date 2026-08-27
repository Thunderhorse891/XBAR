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

import { adoptVaultEntries, referencedVaultKeys } from './localFileVault.js';
import { readRecordsOwner, rememberRecordsOwner } from './recordsOwner.js';

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

  /*
   * The records must actually BE this device's, not merely reference its keys.
   *
   * `adoptVaultEntries` retags every `'local'` entry whose key appears in the
   * record set, and a key collision is not proof of ownership. Import a backup
   * while signed in and the records become the signed-in workspace's, while any
   * file the archive omitted is still on this device tagged `'local'` and still
   * named by those records — `importWorkspaceBackup` warns about exactly those
   * references. A later push or `connected` reconciliation would then hand the
   * local ranch's documents to the signed-in workspace, which can open and
   * export them while the ranch they belong to can no longer reach them.
   *
   * The records-owner marker is what separates the two. A promotion means the
   * records were this device's own: unrecorded, or recorded as `'local'`.
   * Anything else names a workspace these records already belong to, which is
   * an import, not a promotion.
   *
   * Unrecorded still adopts. Every browser predating this marker reads back
   * `''`, and refusing there would break promotion for all of them — the files
   * stop opening after sign-in, which is the bug this function exists to fix.
   * The dangerous case is not reachable through `''`: an import writes the
   * marker before any of these callers run.
   *
   * A successful promotion writes the marker below, so the `connected` retry
   * refuses on later loads. That is correct — a complete move leaves nothing to
   * adopt, and a partial one leaves the marker unwritten so the retry still
   * works.
   */
  const recorded = readRecordsOwner();
  if (recorded && recorded !== 'local') return { adopted: 0, failed: [] };

  const result = await adoptVaultEntries(
    referencedVaultKeys(workspace.documents ?? [], workspace.expenseReceipts ?? [], workspace.salePacketBuilds ?? []),
    'local',
    owner,
  );

  if (result.failed.length === 0) rememberRecordsOwner(owner);

  return result;
}

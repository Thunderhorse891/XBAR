// Which workspace owns a file written to the on-device vault.
//
// The vault is one IndexedDB database per browser ORIGIN; a workspace is not.
// The same browser can hold two cloud accounts, or a cloud workspace and a
// local-only one, so every write records who it belongs to and the orphan sweep
// only ever deletes files it can prove are its own.
//
// One function rather than the expression repeated at each call site: three
// copies of a rule is how the other drifts in this PR started, and the failure
// mode here is deleting a rancher's only copy of a document.

import { useCloudStore } from '@/store/useCloudStore';

/**
 * Who owns files written from here: the cloud workspace, else the signed-in
 * account, else the one local-only workspace.
 *
 * The middle case is the one this function originally missed, and the comment
 * that used to sit here asserted it away: "a browser profile has exactly one
 * local-only workspace, so two cannot be confused". True of signed-OUT use, and
 * false wherever `VITE_SUPABASE_RELATIONAL_SYNC=false`, because
 * `loadWorkspaceAccessProfile` then returns `workspaceId: null` for every
 * signed-in account. Two people signing into the same browser both got
 * `'local'`, which made each of them the other's owner: reads, exports and
 * packet attachments all pass the ownership check, and the sweep treats the
 * other account's files as its own orphans and deletes them.
 *
 * The account id is namespaced rather than used bare. Workspace ids and user
 * ids are both uuids, and an unprefixed value would be indistinguishable from a
 * workspace — a distinction the vault has no other way to make.
 */
export function vaultOwnerId(): string {
  const cloud = useCloudStore.getState();
  if (cloud.workspaceId) return cloud.workspaceId;

  const accountId = cloud.session?.user?.id ?? '';
  if (accountId) return `account:${accountId}`;

  return 'local';
}

/**
 * Run something once the workspace on screen is the one that will stay.
 *
 * Waits for `autosaveReady`, not `initialized`, and the difference is a whole
 * class of data loss. `initialize` publishes the workspace id early; only after
 * that does CloudBootstrap load the remote backup and reconcile it, which can
 * REPLACE every local record. A sweep in between sees the new workspace's id
 * beside the previous workspace's documents — so reloading a browser that last
 * persisted workspace A while signed into B swept B's files against A's keys
 * and deleted them, permanently, before B's records had loaded.
 *
 * `autosaveReady` alone is not that moment, which was the second half of the
 * same bug. It turns true on EVERY path out of CloudBootstrap, including
 * `conflict-lock` and a failed remote load — it means hydration stopped, not
 * that it settled on a copy. A browser that last persisted workspace A, signed
 * into workspace B, whose reconciliation cannot choose between them, reaches
 * `autosaveReady` with B's id beside A's records: exactly the state this
 * function exists to keep the sweep out of, arrived at by a different road.
 *
 * So both are required. `autosaveUnlocked` says reconciliation chose, and both
 * default to true when Supabase is not configured at all, so a local-only
 * workspace does not wait for something that will never happen.
 *
 * When reconciliation stays locked the callback simply never runs. That is the
 * right failure: skipping a cleanup leaves unreferenced bytes on the device
 * until a later session, while running it deletes files that are still someone's
 * only copy.
 */
function settled(cloud: { autosaveReady: boolean; autosaveUnlocked: boolean }): boolean {
  return cloud.autosaveReady && cloud.autosaveUnlocked;
}

export function onWorkspaceSettled(run: () => void): void {
  if (settled(useCloudStore.getState())) {
    run();
    return;
  }

  const unsubscribe = useCloudStore.subscribe((cloud) => {
    if (!settled(cloud)) return;
    unsubscribe();
    run();
  });
}

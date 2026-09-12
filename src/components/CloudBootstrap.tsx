import { useEffect, useRef } from 'react';
import { createLatestWriteGate } from '@/lib/authBootstrap';
import { loadWorkspaceBackupFromCloud, saveWorkspaceBackupToCloud } from '@/lib/cloudWorkspace';
import { decideCloudReconciliation, serializeWorkspaceBackup } from '@/lib/cloudSyncPolicy';
import { promoteLocalVaultFiles } from '@/lib/workspacePromotion';
import { vaultOwnerId } from '@/lib/vaultOwner';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useWorkspaceHydrated, useXbarStore } from '@/store/useXbarStore';

export function CloudBootstrap() {
  const initialize = useCloudStore((state) => state.initialize);
  const cloudStatus = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const workspaceReady = useCloudStore((state) => state.workspaceReady);
  const workspaceRole = useCloudStore((state) => state.workspaceRole);
  const autosaveReady = useCloudStore((state) => state.autosaveReady);
  const autosaveUnlocked = useCloudStore((state) => state.autosaveUnlocked);
  const setLastSyncAt = useCloudStore((state) => state.setLastSyncAt);
  const setSyncState = useCloudStore((state) => state.setSyncState);
  const setWorkspaceAccessProfile = useCloudStore((state) => state.setWorkspaceAccessProfile);
  const setAutosaveReady = useCloudStore((state) => state.setAutosaveReady);
  const settleStagedStorageBytes = useCloudStore((state) => state.settleStagedStorageBytes);
  const setCurrentRole = useXbarStore((state) => state.setCurrentRole);
  const pushToast = useUiStore((state) => state.pushToast);
  const importWorkspaceBackup = useXbarStore((state) => state.importWorkspaceBackup);
  const exportWorkspaceBackup = useXbarStore((state) => state.exportWorkspaceBackup);
  const workspaceHydrated = useWorkspaceHydrated();
  const hydrationKeyRef = useRef('');
  /*
   * Which hydration run is allowed to write.
   *
   * `workspaceReady` is a dependency of the hydration effect, so every re-sync
   * for the same account -- an ordinary token refresh does it -- tears the
   * effect down and builds it again. Tying a run's validity to the effect's
   * lifecycle therefore killed runs that nothing was actually wrong with, and
   * the returning key was read as "already hydrated", so nothing restarted and
   * the autosave lock the run had taken was never released: cloud autosave
   * stopped, silently, until the rancher reloaded.
   *
   * Validity belongs to the run, not to the effect. A run keeps writing across
   * those churns and is retired only when something genuinely replaces it -- a
   * different account, a different workspace, a sign-out -- which is the same
   * rule the store applies to its own session writes, so it is the same gate.
   */
  const hydrationGateRef = useRef(createLatestWriteGate());
  /*
   * Whether this page load has ever held a session.
   *
   * Signing out does NOT swap the workspace records: the store keeps whatever
   * the cloud workspace had, while `vaultOwnerId()` drops back to `'local'`.
   * Treating that as settled would sweep the local workspace's files against a
   * cloud workspace's keys and delete them — the same mismatch the settle gate
   * exists to prevent, reached from the other side.
   */
  const sawSessionRef = useRef(false);
  const lastPersistedSignatureRef = useRef('');

  useEffect(() => {
    let dispose: (() => void) | void;
    void initialize().then((cleanup) => {
      dispose = cleanup;
    });
    return () => {
      dispose?.();
    };
  }, [initialize]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    setCurrentRole(workspaceRole);
  }, [setCurrentRole, workspaceHydrated, workspaceRole]);

  useEffect(() => {
    if (!workspaceHydrated) return;

    if (cloudStatus !== 'signed-in' || !session?.user.id) {
      hydrationKeyRef.current = '';
      // Whatever was loading was loading for somebody else.
      hydrationGateRef.current.retireInFlight();
      lastPersistedSignatureRef.current = serializeWorkspaceBackup(exportWorkspaceBackup());

      /*
       * A workspace with no session to wait for is already settled.
       *
       * Locking unconditionally here was wrong in a slow, quiet way: the vault
       * sweep waits on these flags, so a browser that is signed out — or has no
       * Supabase project at all — never reclaimed the blobs left behind by
       * deleted documents, receipts and packets. Nothing is lost, but IndexedDB
       * fills, and the first thing a full quota breaks is saving the next file.
       *
       * Two states are NOT settled, for different reasons:
       *
       *   `loading`  initialization may still produce a session, and the
       *              records on screen would then be replaced by reconciliation.
       *   after a sign-out  the store still holds the cloud workspace's records
       *              while the vault owner has dropped back to `'local'`.
       *              Sweeping there deletes the local workspace's own files.
       *
       * So it settles only when this page load has never had a session, which
       * is the case where `'local'` really does own what is on screen.
       */
      const resolved = cloudStatus === 'signed-out' || cloudStatus === 'unavailable';
      const settled = resolved && !sawSessionRef.current;
      setAutosaveReady(settled, settled);
      setSyncState('idle');
      return;
    }

    sawSessionRef.current = true;

    /*
     * `session` is now published before the workspace profile resolves, so a
     * session alone is not enough to start hydrating: the key would form
     * against an empty workspace id, and on an account switch it would pair
     * the new user with the PREVIOUS account's workspace.
     *
     * Returning here rather than in the branch above is the whole point.
     * That branch clears `hydrationKeyRef`, and this state is transient --
     * every sync sets `workspaceReady` false and then true again -- so
     * clearing on the way through made the same user and workspace hydrate
     * once per sync instead of once. Two cycles were observed for an ordinary
     * recovery load before this returned early instead. The key still changes
     * on a genuine account or workspace switch, so those still re-run, once.
     *
     * What the suite pins is that PLACEMENT, not this gate's existence:
     * deleting the line outright still passes, because hydration re-derives the
     * workspace from its own profile fetch, so a key formed against an
     * unresolved workspace changes only WHEN hydration re-runs, not what it
     * reads. Kept anyway -- starting work against a workspace id that is known
     * to be provisional is worth refusing on its own terms -- but recorded as
     * unproven rather than left to look tested.
     */
    if (!workspaceReady) return;

    const hydrationKey = `${session.user.id}:${workspaceId || 'primary'}`;
    if (hydrationKeyRef.current === hydrationKey) return;
    hydrationKeyRef.current = hydrationKey;
    setAutosaveReady(false, false);
    const owns = hydrationGateRef.current.begin();

    /*
     * A promotion that only half-moved the files must say so.
     *
     * `promoteLocalVaultFiles` returns the keys it could not retag — an
     * IndexedDB write can fail mid-move — and deliberately leaves the
     * records-owner marker unwritten so the `connected` branch retries on the
     * next load. But its return value was DISCARDED, so this reported a clean
     * reconciliation: `vaultOwnerId()` has already moved to the cloud owner, so
     * every entry still tagged `'local'` is refused by file opening, backup
     * export and packet attachment, while the screen said everything was fine
     * until the rancher happened to reload.
     *
     * Reported as an error, but NOT locked. Those are separate arguments to
     * `finish` for a reason: the RECORDS pushed successfully, and withholding
     * their autosave because a file blob failed to be retagged would turn a
     * partial file problem into a total sync outage. The rancher is told which
     * part did not move and that it will be retried; their ranch work keeps
     * saving in the meantime.
     */
    const promotionMessage = (failed: string[], ok: string) =>
      failed.length === 0
        ? ok
        : `${failed.length} of this device's files could not be moved to the cloud workspace and cannot be opened yet. They are retried automatically the next time this ranch loads.`;

    const finish = (unlocked: boolean, state: 'idle' | 'error', message: string) => {
      if (!owns()) return;
      lastPersistedSignatureRef.current = serializeWorkspaceBackup(exportWorkspaceBackup());
      setSyncState(state, message);
      // `unlocked` is false for `conflict-lock` and for a failed remote load.
      // Ready means hydration stopped; unlocked means it settled on a copy.
      setAutosaveReady(true, unlocked);
    };

    const hydrate = async () => {
      const local = exportWorkspaceBackup();
      setSyncState('syncing', 'Reconciling this ranch with cloud records...');
      const remote = await loadWorkspaceBackupFromCloud();
      if (!owns()) return;
      const decision = decideCloudReconciliation({
        local,
        ...(remote.ok ? { remote: remote.backup } : { remoteError: remote.message }),
      });

      if (decision === 'import-remote' && remote.ok) {
        const imported = importWorkspaceBackup(remote.backup);
        if (imported.ok && remote.updatedAt) setLastSyncAt(remote.updatedAt);
        finish(
          imported.ok,
          imported.ok ? 'idle' : 'error',
          imported.ok ? 'Cloud workspace loaded safely.' : imported.message,
        );
        return;
      }

      if (decision === 'push-local') {
        const saved = await saveWorkspaceBackupToCloud(local);
        if (!owns()) return;
        if (saved.ok && saved.updatedAt) setLastSyncAt(saved.updatedAt);
        if (saved.ok && saved.workspaceId && saved.workspaceId !== workspaceId) {
          setWorkspaceAccessProfile(saved.workspaceId, 'Admin');
        }

        /*
         * The device's files come with the records.
         *
         * This branch is a promotion: the local workspace won reconciliation
         * and has just become this account's cloud workspace. Its vault entries
         * are still owned by `'local'`, and every ownership check now compares
         * against the new owner — so without this the rancher signs in and
         * their documents stop opening, exporting and attaching, while the
         * records still name them.
         */
        let promotionFailed: string[] = [];
        if (saved.ok) {
          const promoted = await promoteLocalVaultFiles(
            local.workspace as Parameters<typeof promoteLocalVaultFiles>[0],
            vaultOwnerId(),
          );
          if (!owns()) return;
          promotionFailed = promoted.failed;
        }

        finish(
          saved.ok,
          saved.ok && promotionFailed.length === 0 ? 'idle' : 'error',
          saved.ok ? promotionMessage(promotionFailed, saved.message) : saved.message,
        );
        return;
      }

      if (decision === 'connected') {
        if (remote.ok && remote.updatedAt) setLastSyncAt(remote.updatedAt);

        /*
         * Promotion is retried here, and this is the decision a retry lands on.
         *
         * Once the push has succeeded the two copies agree, so every later load
         * decides `connected` rather than `push-local`. Adopting only there
         * meant a move that half-failed was never attempted again, and the
         * files left behind stayed refused. Both decisions mean the same thing
         * about ownership — the local records ARE this workspace's — so both
         * may hand the files over. `import-remote` does not: its records came
         * from the cloud, and a `'local'` file they happen to name is another
         * workspace's, not this one's.
         */
        const promoted = await promoteLocalVaultFiles(
          local.workspace as Parameters<typeof promoteLocalVaultFiles>[0],
          vaultOwnerId(),
        );
        if (!owns()) return;

        finish(
          true,
          promoted.failed.length === 0 ? 'idle' : 'error',
          promotionMessage(promoted.failed, 'Cloud workspace connected.'),
        );
        return;
      }

      if (decision === 'empty-ready') {
        finish(true, 'idle', remote.ok ? 'Cloud workspace ready.' : remote.message);
        return;
      }

      finish(
        false,
        'error',
        decision === 'conflict-lock'
          ? 'Local and cloud both contain different ranch work. Autosave is locked until you choose Push cloud or Pull cloud in Settings.'
          : remote.ok
            ? 'Cloud workspace needs review.'
            : remote.message,
      );
    };

    /*
     * A rejection has to settle the run too.
     *
     * Every decision branch inside `hydrate` ends in `finish`, but a throw on
     * the way there -- a vault promotion failing hard, a serializer meeting a
     * record it cannot read -- skipped all of them and left `autosaveReady`
     * false for the rest of the page's life. That already stopped cloud
     * autosave silently; now that RequireWorkspaceSetup waits on the same flag
     * before it will call a workspace unfinished, it would also hold the app on
     * its loading shell. `finish` is gated on `owns()`, so a superseded run
     * still writes nothing.
     */
    void hydrate().catch(() => {
      finish(
        false,
        'error',
        'This ranch could not be reconciled with the cloud. The records on this device are unchanged and autosave is paused until you choose Push cloud or Pull cloud in Settings.',
      );
    });
    /*
     * No cleanup that invalidates the run.
     *
     * React tears this effect down on every dependency change, including the
     * transient `workspaceReady` flip that a same-account re-sync produces.
     * Cancelling there is what stranded the run; the gate above retires a run
     * when it is genuinely superseded instead.
     */
  }, [
    cloudStatus,
    exportWorkspaceBackup,
    importWorkspaceBackup,
    session?.user.id,
    setAutosaveReady,
    setLastSyncAt,
    setSyncState,
    setWorkspaceAccessProfile,
    workspaceHydrated,
    workspaceId,
    workspaceReady,
  ]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    if (cloudStatus !== 'signed-in' || !autosaveReady || !autosaveUnlocked) return;
    let disposed = false;
    let syncTimeout: number | undefined;
    let saving = false;

    const persistCurrent = async () => {
      if (disposed || saving) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncState('error', 'Offline. Ranch changes remain local and will retry when the connection returns.');
        return;
      }
      const backup = exportWorkspaceBackup();
      /*
       * Read before the request and released only for this amount. The document
       * intake counts bytes it has put in the bucket so the capacity check can
       * add them to the server's total; once the server holds those rows they
       * are inside that total and would otherwise be counted twice. Releasing
       * the captured amount rather than zeroing is what keeps an upload that
       * lands while this save is in flight -- and so is not in this snapshot --
       * still counted.
       */
      const stagedAtSnapshot = useCloudStore.getState().stagedStorageBytes;
      const signature = serializeWorkspaceBackup(backup);
      if (signature === lastPersistedSignatureRef.current) return;
      saving = true;
      setSyncState('syncing', 'Saving ranch changes to cloud...');
      const result = await saveWorkspaceBackupToCloud(backup);
      saving = false;
      if (disposed) return;
      if (result.ok) {
        if (result.workspaceId && result.workspaceId !== workspaceId) {
          setWorkspaceAccessProfile(result.workspaceId, 'Admin');
        }
        lastPersistedSignatureRef.current = signature;
        /*
         * Only when the DOCUMENT ROWS actually reached the database. With the
         * snapshot fallback enabled a rejected relational save still reports
         * `ok` once the legacy snapshot lands -- the rancher's work is safe,
         * which is what `ok` means -- but `xbar_workspace_storage_bytes` reads
         * `documents`, and nothing was added to it. Releasing the reservation
         * there would leave the uploaded objects counted by nobody, and every
         * later batch would pass the gate against a total that never grows.
         */
        if (result.relationalRowsPersisted) settleStagedStorageBytes(stagedAtSnapshot);
        if (result.updatedAt) setLastSyncAt(result.updatedAt);
        setSyncState('idle', result.message);
      } else {
        const message = `${result.message} Changes remain local and will retry.`;
        setSyncState('error', message);
        pushToast({
          id: 'cloud-autosave-failed',
          title: 'Cloud save paused',
          message,
          tone: 'error',
          duration: 10000,
        });
      }
    };

    const queuePersist = () => {
      if (syncTimeout) window.clearTimeout(syncTimeout);
      syncTimeout = window.setTimeout(() => {
        void persistCurrent();
      }, 1600);
    };
    const unsubscribe = useXbarStore.subscribe(queuePersist);
    window.addEventListener('online', queuePersist);
    queuePersist();

    return () => {
      disposed = true;
      if (syncTimeout) window.clearTimeout(syncTimeout);
      unsubscribe();
      window.removeEventListener('online', queuePersist);
    };
  }, [
    autosaveReady,
    autosaveUnlocked,
    cloudStatus,
    exportWorkspaceBackup,
    pushToast,
    setLastSyncAt,
    setSyncState,
    setWorkspaceAccessProfile,
    settleStagedStorageBytes,
    workspaceHydrated,
    workspaceId,
  ]);

  return null;
}

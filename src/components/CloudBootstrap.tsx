import { useEffect, useRef } from 'react';
import { loadWorkspaceBackupFromCloud, saveWorkspaceBackupToCloud } from '@/lib/cloudWorkspace';
import { decideCloudReconciliation, serializeWorkspaceBackup } from '@/lib/cloudSyncPolicy';
import { promoteLocalVaultFiles } from '@/lib/workspacePromotion';
import { vaultOwnerId } from '@/lib/vaultOwner';
import { useCloudStore } from '@/store/useCloudStore';
import { useWorkspaceHydrated, useXbarStore } from '@/store/useXbarStore';

export function CloudBootstrap() {
  const initialize = useCloudStore((state) => state.initialize);
  const cloudStatus = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const workspaceRole = useCloudStore((state) => state.workspaceRole);
  const autosaveReady = useCloudStore((state) => state.autosaveReady);
  const autosaveUnlocked = useCloudStore((state) => state.autosaveUnlocked);
  const setLastSyncAt = useCloudStore((state) => state.setLastSyncAt);
  const setSyncState = useCloudStore((state) => state.setSyncState);
  const setWorkspaceAccessProfile = useCloudStore((state) => state.setWorkspaceAccessProfile);
  const setAutosaveReady = useCloudStore((state) => state.setAutosaveReady);
  const setCurrentRole = useXbarStore((state) => state.setCurrentRole);
  const importWorkspaceBackup = useXbarStore((state) => state.importWorkspaceBackup);
  const exportWorkspaceBackup = useXbarStore((state) => state.exportWorkspaceBackup);
  const workspaceHydrated = useWorkspaceHydrated();
  const hydrationKeyRef = useRef('');
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

    const hydrationKey = `${session.user.id}:${workspaceId || 'primary'}`;
    if (hydrationKeyRef.current === hydrationKey) return;
    hydrationKeyRef.current = hydrationKey;
    setAutosaveReady(false, false);
    let cancelled = false;

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
      if (cancelled) return;
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
      if (cancelled) return;
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
        if (cancelled) return;
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
          if (cancelled) return;
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
        if (cancelled) return;

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

    void hydrate();
    return () => {
      cancelled = true;
    };
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
        if (result.updatedAt) setLastSyncAt(result.updatedAt);
        setSyncState('idle', result.message);
      } else {
        setSyncState('error', `${result.message} Changes remain local and will retry.`);
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
    setLastSyncAt,
    setSyncState,
    setWorkspaceAccessProfile,
    workspaceHydrated,
    workspaceId,
  ]);

  return null;
}

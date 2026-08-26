import { useEffect, useRef } from 'react';
import { loadWorkspaceBackupFromCloud, saveWorkspaceBackupToCloud } from '@/lib/cloudWorkspace';
import { decideCloudReconciliation, serializeWorkspaceBackup } from '@/lib/cloudSyncPolicy';
import { adoptVaultEntries, referencedVaultKeys } from '@/lib/localFileVault';
import { rememberRecordsOwner } from '@/lib/recordsOwner';
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

        /*
         * The device's files come with the records.
         *
         * This branch is a promotion: the local workspace won reconciliation
         * and has just become this account's cloud workspace. Its vault entries
         * are still owned by `'local'`, and every ownership check now compares
         * against the new owner — so without this the rancher signs in and
         * their documents stop opening, exporting and attaching, while the
         * records still name them.
         *
         * Only entries these records REFERENCE, and only ones still `'local'`
         * or untagged, so a previous account's files cannot be swept up: their
         * records carry their own keys and match nothing here.
         */
        if (saved.ok) {
          const workspace = local.workspace as {
            documents?: { localFileKey?: string }[];
            expenseReceipts?: { localFileKey?: string }[];
            salePacketBuilds?: { localFileKey?: string }[];
          };
          await adoptVaultEntries(
            referencedVaultKeys(
              workspace.documents ?? [],
              workspace.expenseReceipts ?? [],
              workspace.salePacketBuilds ?? [],
            ),
            'local',
            vaultOwnerId(),
          );
          // The records are this workspace's now, or the sweep will refuse to
          // run for it — the marker and the vault owner have to agree.
          rememberRecordsOwner(vaultOwnerId());
          if (cancelled) return;
        }

        finish(saved.ok, saved.ok ? 'idle' : 'error', saved.message);
        return;
      }

      if (decision === 'connected') {
        if (remote.ok && remote.updatedAt) setLastSyncAt(remote.updatedAt);
        finish(true, 'idle', 'Cloud workspace connected.');
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
    workspaceHydrated,
  ]);

  return null;
}

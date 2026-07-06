import { useEffect, useRef } from 'react';
import { loadWorkspaceBackupFromCloud, saveWorkspaceBackupToCloud } from '@/lib/cloudWorkspace';
import { decideCloudReconciliation, serializeWorkspaceBackup } from '@/lib/cloudSyncPolicy';
import { useCloudStore } from '@/store/useCloudStore';
import { useWorkspaceHydrated, useXbarStore } from '@/store/useXbarStore';

export function CloudBootstrap() {
  const initialize = useCloudStore((state) => state.initialize);
  const cloudStatus = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const workspaceRole = useCloudStore((state) => state.workspaceRole);
  const autosaveReady = useCloudStore((state) => state.autosaveReady);
  const setLastSyncAt = useCloudStore((state) => state.setLastSyncAt);
  const setSyncState = useCloudStore((state) => state.setSyncState);
  const setAutosaveReady = useCloudStore((state) => state.setAutosaveReady);
  const setCurrentRole = useXbarStore((state) => state.setCurrentRole);
  const importWorkspaceBackup = useXbarStore((state) => state.importWorkspaceBackup);
  const exportWorkspaceBackup = useXbarStore((state) => state.exportWorkspaceBackup);
  const workspaceHydrated = useWorkspaceHydrated();
  const hydrationKeyRef = useRef('');
  const autosaveUnlockedRef = useRef(false);
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
      autosaveUnlockedRef.current = false;
      lastPersistedSignatureRef.current = serializeWorkspaceBackup(exportWorkspaceBackup());
      setAutosaveReady(false);
      setSyncState('idle');
      return;
    }

    const hydrationKey = `${session.user.id}:${workspaceId || 'primary'}`;
    if (hydrationKeyRef.current === hydrationKey) return;
    hydrationKeyRef.current = hydrationKey;
    autosaveUnlockedRef.current = false;
    setAutosaveReady(false);
    let cancelled = false;

    const finish = (unlocked: boolean, state: 'idle' | 'error', message: string) => {
      if (cancelled) return;
      autosaveUnlockedRef.current = unlocked;
      lastPersistedSignatureRef.current = serializeWorkspaceBackup(exportWorkspaceBackup());
      setSyncState(state, message);
      setAutosaveReady(true);
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
    if (cloudStatus !== 'signed-in' || !autosaveReady || !autosaveUnlockedRef.current) return;
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
  }, [autosaveReady, cloudStatus, exportWorkspaceBackup, setLastSyncAt, setSyncState, workspaceHydrated]);

  return null;
}

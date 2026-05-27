import { useEffect } from 'react';
import { loadWorkspaceBackupFromCloud, saveWorkspaceBackupToCloud } from '@/lib/cloudWorkspace';
import { useCloudStore } from '@/store/useCloudStore';
import { useXbarStore } from '@/store/useXbarStore';

export function CloudBootstrap() {
  const initialize = useCloudStore((state) => state.initialize);
  const cloudStatus = useCloudStore((state) => state.status);
  const workspaceRole = useCloudStore((state) => state.workspaceRole);
  const autosaveReady = useCloudStore((state) => state.autosaveReady);
  const setLastSyncAt = useCloudStore((state) => state.setLastSyncAt);
  const setSyncState = useCloudStore((state) => state.setSyncState);
  const setAutosaveReady = useCloudStore((state) => state.setAutosaveReady);
  const setCurrentRole = useXbarStore((state) => state.setCurrentRole);
  const importWorkspaceBackup = useXbarStore((state) => state.importWorkspaceBackup);

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
    setCurrentRole(workspaceRole);
  }, [setCurrentRole, workspaceRole]);

  // On sign-in: pull cloud data first, import it, then unlock autosave.
  // This prevents stale/empty local state from overwriting good cloud data.
  useEffect(() => {
    if (cloudStatus !== 'signed-in') {
      return;
    }

    let disposed = false;

    void loadWorkspaceBackupFromCloud().then((result) => {
      if (disposed) {
        return;
      }

      if (result.ok) {
        importWorkspaceBackup(result.backup);
      }

      // Unlock autosave regardless — if no cloud backup exists yet, that is fine.
      setAutosaveReady(true);
    });

    return () => {
      disposed = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudStatus]);

  // Autosave — only runs after cloud pull has completed (autosaveReady === true).
  useEffect(() => {
    if (cloudStatus !== 'signed-in' || !autosaveReady) {
      setSyncState('idle');
      return;
    }

    let disposed = false;
    let syncTimeout: number | undefined;

    const unsubscribe = useXbarStore.subscribe(() => {
      if (syncTimeout) {
        window.clearTimeout(syncTimeout);
      }

      setSyncState('syncing', 'Saving workspace changes to cloud...');
      syncTimeout = window.setTimeout(async () => {
        if (disposed) {
          return;
        }

        if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
          setSyncState('error', 'Offline. Workspace changes remain local until the connection returns.');
          return;
        }

        const backup = useXbarStore.getState().exportWorkspaceBackup();
        const result = await saveWorkspaceBackupToCloud(backup);
        if (disposed) {
          return;
        }

        if (result.ok && result.updatedAt) {
          setLastSyncAt(result.updatedAt);
          setSyncState('idle', result.message);
          return;
        }

        setSyncState('error', result.message);
      }, 1600);
    });

    return () => {
      disposed = true;
      if (syncTimeout) {
        window.clearTimeout(syncTimeout);
      }
      unsubscribe();
    };
  }, [cloudStatus, autosaveReady, setLastSyncAt, setSyncState]);

  return null;
}

import { useEffect } from 'react';
import { saveWorkspaceBackupToCloud } from '@/lib/cloudWorkspace';
import { useCloudStore } from '@/store/useCloudStore';
import { useXbarStore } from '@/store/useXbarStore';

export function CloudBootstrap() {
  const initialize = useCloudStore((state) => state.initialize);
  const cloudStatus = useCloudStore((state) => state.status);
  const workspaceRole = useCloudStore((state) => state.workspaceRole);
  const setLastSyncAt = useCloudStore((state) => state.setLastSyncAt);
  const setSyncState = useCloudStore((state) => state.setSyncState);
  const setCurrentRole = useXbarStore((state) => state.setCurrentRole);

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

  useEffect(() => {
    if (cloudStatus !== 'signed-in') {
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
  }, [cloudStatus, setLastSyncAt, setSyncState]);

  return null;
}

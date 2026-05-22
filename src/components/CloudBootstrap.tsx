import { useEffect, useRef } from 'react';
import { loadWorkspaceBackupFromCloud, saveWorkspaceBackupToCloud } from '@/lib/cloudWorkspace';
import { useCloudStore } from '@/store/useCloudStore';
import { useXbarStore } from '@/store/useXbarStore';

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getWorkspacePayload(backup: unknown) {
  const record = asRecord(backup);
  if (!record) {
    return null;
  }

  return asRecord(record.workspace) ?? record;
}

function readListLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function hasMeaningfulWorkspace(backup: unknown) {
  const workspace = getWorkspacePayload(backup);
  if (!workspace) {
    return false;
  }

  const profile = asRecord(workspace.workspaceProfile);
  const hasProfileData = [
    profile?.setupCompleteAt,
    profile?.businessName,
    profile?.ranchName,
    profile?.defaultOwnerName,
    profile?.defaultOwnerEntity,
    profile?.ranchManagerName,
    profile?.operationsEmail,
    profile?.defaultBarn,
    profile?.defaultPasture,
  ].some((value) => typeof value === 'string' && value.trim());

  return (
    hasProfileData ||
    [
      'horses',
      'documents',
      'intakeBatches',
      'expenseReceipts',
      'ranchAssets',
      'salesLeads',
      'sharedListings',
      'workspaceMembers',
      'workspaceInvitations',
    ].some((key) => readListLength(workspace[key]) > 0)
  );
}

function serializeWorkspaceBackup(backup: unknown) {
  const workspace = getWorkspacePayload(backup);
  if (!workspace) {
    return '';
  }

  const normalizedWorkspace = { ...workspace };
  const profile = asRecord(workspace.workspaceProfile);
  if (profile) {
    normalizedWorkspace.workspaceProfile = {
      ...profile,
      lastCloudSyncAt: '',
    };
  }

  return JSON.stringify(normalizedWorkspace);
}

function isMissingCloudWorkspaceMessage(message: string) {
  return message.toLowerCase().includes('no cloud workspace');
}

export function CloudBootstrap() {
  const initialize = useCloudStore((state) => state.initialize);
  const cloudStatus = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const workspaceRole = useCloudStore((state) => state.workspaceRole);
  const setLastSyncAt = useCloudStore((state) => state.setLastSyncAt);
  const setSyncState = useCloudStore((state) => state.setSyncState);
  const setCurrentRole = useXbarStore((state) => state.setCurrentRole);
  const importWorkspaceBackup = useXbarStore((state) => state.importWorkspaceBackup);
  const exportWorkspaceBackup = useXbarStore((state) => state.exportWorkspaceBackup);
  const hydrationKeyRef = useRef('');
  const autosaveUnlockedRef = useRef(false);
  const lastPersistedSignatureRef = useRef(serializeWorkspaceBackup(exportWorkspaceBackup()));

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
    if (cloudStatus !== 'signed-in' || !session?.user.id) {
      hydrationKeyRef.current = '';
      autosaveUnlockedRef.current = false;
      lastPersistedSignatureRef.current = serializeWorkspaceBackup(exportWorkspaceBackup());
      setSyncState('idle');
      return;
    }

    const hydrationKey = `${session.user.id}:${workspaceId || 'primary'}`;
    if (hydrationKeyRef.current === hydrationKey) {
      return;
    }

    hydrationKeyRef.current = hydrationKey;
    autosaveUnlockedRef.current = false;
    let cancelled = false;

    const hydrateWorkspace = async () => {
      const localBackup = exportWorkspaceBackup();
      const localHasWorkspace = hasMeaningfulWorkspace(localBackup);
      setSyncState('syncing', 'Loading workspace from cloud...');

      const remote = await loadWorkspaceBackupFromCloud();
      if (cancelled) {
        return;
      }

      if (remote.ok) {
        const remoteHasWorkspace = hasMeaningfulWorkspace(remote.backup);
        if (remote.updatedAt) {
          setLastSyncAt(remote.updatedAt);
        }

        if (remoteHasWorkspace && !localHasWorkspace) {
          const imported = importWorkspaceBackup(remote.backup);
          autosaveUnlockedRef.current = imported.ok;
          lastPersistedSignatureRef.current = serializeWorkspaceBackup(exportWorkspaceBackup());
          setSyncState(imported.ok ? 'idle' : 'error', imported.ok ? 'Cloud workspace loaded.' : imported.message);
          return;
        }

        if (!remoteHasWorkspace && localHasWorkspace) {
          const saved = await saveWorkspaceBackupToCloud(localBackup);
          if (cancelled) {
            return;
          }

          if (saved.ok && saved.updatedAt) {
            setLastSyncAt(saved.updatedAt);
          }

          autosaveUnlockedRef.current = saved.ok;
          lastPersistedSignatureRef.current = serializeWorkspaceBackup(exportWorkspaceBackup());
          setSyncState(saved.ok ? 'idle' : 'error', saved.message);
          return;
        }

        if (remoteHasWorkspace && localHasWorkspace) {
          autosaveUnlockedRef.current = serializeWorkspaceBackup(remote.backup) === serializeWorkspaceBackup(localBackup);
          setSyncState(
            autosaveUnlockedRef.current ? 'idle' : 'error',
            autosaveUnlockedRef.current
              ? 'Cloud workspace connected.'
              : 'Cloud already has workspace data. Autosave is locked until you refresh from cloud or complete a manual merge.',
          );
          return;
        }

        autosaveUnlockedRef.current = true;
        lastPersistedSignatureRef.current = serializeWorkspaceBackup(exportWorkspaceBackup());
        setSyncState('idle', 'Cloud workspace ready.');
        return;
      }

      if (localHasWorkspace && isMissingCloudWorkspaceMessage(remote.message)) {
        const saved = await saveWorkspaceBackupToCloud(localBackup);
        if (cancelled) {
          return;
        }

        if (saved.ok && saved.updatedAt) {
          setLastSyncAt(saved.updatedAt);
        }

        autosaveUnlockedRef.current = saved.ok;
        lastPersistedSignatureRef.current = serializeWorkspaceBackup(exportWorkspaceBackup());
        setSyncState(saved.ok ? 'idle' : 'error', saved.message);
        return;
      }

      autosaveUnlockedRef.current = !localHasWorkspace;
      lastPersistedSignatureRef.current = serializeWorkspaceBackup(exportWorkspaceBackup());
      setSyncState(localHasWorkspace ? 'error' : 'idle', remote.message);
    };

    void hydrateWorkspace();

    return () => {
      cancelled = true;
    };
  }, [cloudStatus, exportWorkspaceBackup, importWorkspaceBackup, session?.user.id, setLastSyncAt, setSyncState, workspaceId]);

  useEffect(() => {
    if (cloudStatus !== 'signed-in') {
      setSyncState('idle');
      return;
    }

    if (!autosaveUnlockedRef.current) {
      return;
    }

    let disposed = false;
    let syncTimeout: number | undefined;

    const unsubscribe = useXbarStore.subscribe(() => {
      const nextBackup = exportWorkspaceBackup();
      const nextSignature = serializeWorkspaceBackup(nextBackup);

      if (nextSignature === lastPersistedSignatureRef.current) {
        return;
      }

      lastPersistedSignatureRef.current = nextSignature;

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

        const backup = exportWorkspaceBackup();
        const result = await saveWorkspaceBackupToCloud(backup);
        if (disposed) {
          return;
        }

        if (result.ok && result.updatedAt) {
          setLastSyncAt(result.updatedAt);
          lastPersistedSignatureRef.current = serializeWorkspaceBackup(exportWorkspaceBackup());
          setSyncState('idle', result.message);
          return;
        }

        setSyncState(result.ok ? 'idle' : 'error', result.message);
      }, 1600);
    });

    return () => {
      disposed = true;
      if (syncTimeout) {
        window.clearTimeout(syncTimeout);
      }
      unsubscribe();
    };
  }, [cloudStatus, exportWorkspaceBackup, setLastSyncAt, setSyncState]);

  return null;
}

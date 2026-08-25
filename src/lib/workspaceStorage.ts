import type { StateStorage } from 'zustand/middleware';

const DATABASE_NAME = 'xbar-workspace';
const STORE_NAME = 'persist';
const LEGACY_KEY = 'xbar-live-workspace';

export const workspaceStorageDriverLabel = 'IndexedDB primary, localStorage fallback';

function hasBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readLegacyValue(name: string) {
  if (!hasBrowserStorage()) {
    return null;
  }

  try {
    return window.localStorage.getItem(name);
  } catch {
    return null;
  }
}

function writeLegacyValue(name: string, value: string): boolean {
  if (!hasBrowserStorage()) {
    return false;
  }

  try {
    window.localStorage.setItem(name, value);
    return true;
  } catch {
    // Reported rather than ignored. This is the LAST place the workspace can be
    // written — IndexedDB has already refused — so a swallowed failure here is
    // the whole ranch's records not being saved with nothing on screen saying
    // so. See notifyPersistFailure below.
    return false;
  }
}

function removeLegacyValue(name: string) {
  if (!hasBrowserStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(name);
  } catch {
    // Ignore storage cleanup issues.
  }
}

function openWorkspaceDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available.'));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open the workspace database.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openWorkspaceDatabase();

  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = action(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    });
  } finally {
    database.close();
  }
}

async function readIndexedValue(name: string) {
  try {
    return await withStore<string | null>('readonly', (store) => store.get(name));
  } catch {
    return null;
  }
}

async function writeIndexedValue(name: string, value: string) {
  try {
    await withStore('readwrite', (store) => store.put(value, name));
    return true;
  } catch {
    return false;
  }
}

async function removeIndexedValue(name: string) {
  try {
    await withStore('readwrite', (store) => store.delete(name));
  } catch {
    // Ignore cleanup failures and let legacy storage remain the fallback.
  }
}

function parsePersistedState(value: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as { state?: unknown } | unknown;
    if (parsed && typeof parsed === 'object' && 'state' in parsed) {
      return (parsed as { state?: unknown }).state;
    }
    return parsed;
  } catch {
    return null;
  }
}

function hasItems(state: Record<string, unknown>, key: string) {
  const value = state[key];
  return Array.isArray(value) && value.length > 0;
}

export function hasMeaningfulPersistedWorkspace(value: string | null) {
  const state = parsePersistedState(value);
  if (!state || typeof state !== 'object') return false;

  const workspace = state as Record<string, unknown>;
  const profile =
    workspace.workspaceProfile && typeof workspace.workspaceProfile === 'object'
      ? (workspace.workspaceProfile as Record<string, unknown>)
      : null;

  return Boolean(
    (typeof profile?.setupCompleteAt === 'string' && profile.setupCompleteAt.trim()) ||
    hasItems(workspace, 'horses') ||
    hasItems(workspace, 'documents') ||
    hasItems(workspace, 'intakeBatches') ||
    hasItems(workspace, 'salePacketBuilds') ||
    hasItems(workspace, 'buyerRoomEvents') ||
    hasItems(workspace, 'workspaceMembers') ||
    hasItems(workspace, 'workspaceInvitations'),
  );
}

export function shouldProtectMeaningfulWorkspaceWrite(existingValue: string | null, nextValue: string) {
  return hasMeaningfulPersistedWorkspace(existingValue) && !hasMeaningfulPersistedWorkspace(nextValue);
}

/*
 * Telling someone when the workspace could not be saved.
 *
 * zustand's persist middleware discards whatever `setItem` returns, so a
 * storage failure had no way out of this module and the app went on looking
 * exactly like one that had saved. A rancher entering a day of records into a
 * browser that is out of quota, or in a private window with storage disabled,
 * would lose all of it on reload with nothing having said a word.
 *
 * A listener rather than a thrown error: throwing here aborts the state update
 * that triggered the write, so the failure to SAVE would also become a failure
 * to EDIT. The work stays in memory and usable; the app just stops claiming it
 * is safe.
 */
export interface WorkspacePersistFailure {
  /** The storage key that could not be written. */
  name: string;
}

type PersistFailureListener = (failure: WorkspacePersistFailure) => void;

const persistFailureListeners = new Set<PersistFailureListener>();

/** Subscribe to persistence failures. Returns an unsubscribe function. */
export function onWorkspacePersistFailure(listener: PersistFailureListener): () => void {
  persistFailureListeners.add(listener);
  return () => {
    persistFailureListeners.delete(listener);
  };
}

function notifyPersistFailure(name: string) {
  for (const listener of persistFailureListeners) {
    try {
      listener({ name });
    } catch (error) {
      // A broken listener must not take down the write path it is reporting on.
      console.error('A workspace persistence listener threw.', error);
    }
  }
}

export const workspaceStateStorage: StateStorage = {
  async getItem(name) {
    const indexedValue = await readIndexedValue(name);
    if (indexedValue) {
      return indexedValue;
    }

    const legacyValue = readLegacyValue(name);
    if (legacyValue) {
      await writeIndexedValue(name, legacyValue);
      if (name === LEGACY_KEY) {
        removeLegacyValue(name);
      }
    }

    return legacyValue;
  },
  async setItem(name, value) {
    if (name === LEGACY_KEY) {
      const existingValue = (await readIndexedValue(name)) ?? readLegacyValue(name);
      if (shouldProtectMeaningfulWorkspaceWrite(existingValue, value)) {
        return;
      }
    }

    const persisted = await writeIndexedValue(name, value);
    if (!persisted) {
      if (!writeLegacyValue(name, value)) {
        // Both stores refused. The app carries on with the workspace in memory,
        // which is the right behaviour — losing the current session's work on
        // top of a storage failure helps nobody — but it must not look saved.
        notifyPersistFailure(name);
      }
      return;
    }

    if (name === LEGACY_KEY) {
      removeLegacyValue(name);
    }
  },
  async removeItem(name) {
    await removeIndexedValue(name);
    removeLegacyValue(name);
  },
};

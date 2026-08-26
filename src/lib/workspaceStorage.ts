import type { StateStorage } from 'zustand/middleware';

const DATABASE_NAME = 'xbar-workspace';
const STORE_NAME = 'persist';
const LEGACY_KEY = 'xbar-live-workspace';

export const workspaceStorageDriverLabel = 'IndexedDB primary, localStorage fallback';

function hasBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/*
 * Reports whether the read FAILED, not just what it found.
 *
 * `null` from this function used to mean both "no legacy value" and "the read
 * threw", and the caller could not tell them apart — which is the same
 * conflation `workspaceReadFailure` exists to resolve one storage layer up.
 *
 * `hasBrowserStorage` is inside the try because reaching for
 * `window.localStorage` is itself a throwing operation: browsers configured to
 * block site data raise SecurityError from the getter, so even `typeof` on it
 * throws. That escaped this module entirely before.
 */
function readLegacyValue(name: string): { value: string | null; failed: boolean } {
  try {
    if (!hasBrowserStorage()) {
      // No storage API at all — server-side rendering, a stripped embedder.
      // That is an absence, not a failure: there is nothing here to have lost.
      return { value: null, failed: false };
    }

    return { value: window.localStorage.getItem(name), failed: false };
  } catch (error) {
    console.error('Reading the legacy workspace value failed.', error);
    return { value: null, failed: true };
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

      /*
       * Held until the transaction COMMITS, not returned on the request.
       *
       * A successful `put` is not a durable write: IndexedDB can still abort
       * while committing — a browser out of quota does exactly that — and the
       * whole transaction is rolled back. Resolving on `request.onsuccess` made
       * `writeIndexedValue` return true for a write that never landed, which
       * skipped both the localStorage fallback and the failure notice below.
       * The workspace then looked saved and was gone on reload.
       *
       * The file vault carries the identical rule in its own `withStore`. Two
       * copies, because these are deliberately separate databases; if a third
       * ever appears it needs this too.
       */
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    });
  } finally {
    // Safe only because the promise above settles on the transaction's own
    // completion rather than on the request's.
    database.close();
  }
}

/*
 * Whether the last workspace read failed, as opposed to finding nothing.
 *
 * These are the same value — `null` — and telling them apart is load-bearing.
 * The file-vault sweep reclaims blobs the workspace no longer references, so a
 * transient read failure that hydrates the empty initial state would classify
 * EVERY stored document, receipt and packet as an orphan and delete all of
 * them, permanently, on a start-up that recovers on the next reload.
 *
 * "Nothing stored" is a real and common state — a fresh install — so the sweep
 * cannot simply refuse on an empty reference set. It has to know which kind of
 * empty this is.
 */
let workspaceReadFailure = false;

export function didWorkspaceReadFail(): boolean {
  return workspaceReadFailure;
}

/*
 * Reports the failure rather than recording it.
 *
 * Setting `workspaceReadFailure` here was wrong twice over. A successful but
 * EMPTY IndexedDB read cleared the flag before the localStorage fallback had
 * been tried, so a workspace living only in the fallback — the state every
 * browser that has ever refused an IndexedDB write ends up in — could have its
 * fallback read throw and still be reported as "nothing stored". And because
 * `setItem` calls this too, an ordinary write between hydration and the
 * deferred sweep could clear a failure that hydration had correctly recorded.
 *
 * Only `getItem` knows whether the workspace was read, so only `getItem` sets
 * the flag now.
 */
async function readIndexedValue(name: string): Promise<{ value: string | null; failed: boolean }> {
  try {
    const value = await withStore<string | null>('readonly', (store) => store.get(name));
    return { value, failed: false };
  } catch (error) {
    console.error('Reading the persisted workspace failed.', error);
    return { value: null, failed: true };
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
    const indexed = await readIndexedValue(name);
    if (indexed.value) {
      // The workspace was found. Whatever the fallback would have said is moot.
      workspaceReadFailure = false;
      return indexed.value;
    }

    const legacy = readLegacyValue(name);

    /*
     * "Absent" requires BOTH stores to have answered.
     *
     * This is the whole point of the flag: the sweep deletes vault files the
     * workspace no longer references, so it must know whether an empty
     * reference set means "fresh install" or "we could not read it". One store
     * saying nothing while the other throws proves neither.
     */
    workspaceReadFailure = indexed.failed || legacy.failed;

    if (legacy.value) {
      await writeIndexedValue(name, legacy.value);
      if (name === LEGACY_KEY) {
        removeLegacyValue(name);
      }
    }

    return legacy.value;
  },
  async setItem(name, value) {
    if (name === LEGACY_KEY) {
      const existingValue = (await readIndexedValue(name)).value ?? readLegacyValue(name).value;
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

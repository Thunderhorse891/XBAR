import type { StateStorage } from 'zustand/middleware';

const DATABASE_NAME = 'xbar-workspace';
const STORE_NAME = 'persist';
const LEGACY_KEY = 'xbar-live-workspace';

export const workspaceStorageDriverLabel = 'IndexedDB primary, localStorage fallback';

/*
 * Whether localStorage can be reached — reported as a VALUE, never as a throw.
 *
 * Reaching for `window.localStorage` is itself a throwing operation: a browser
 * configured to block site data raises SecurityError from the GETTER, so even
 * `typeof` on it throws before any method is named.
 *
 * This used to be a plain boolean that could throw, which left every caller
 * responsible for remembering to be inside a try. Two of the three were not,
 * and the one that mattered was the write path: with IndexedDB already
 * refusing, a blocked getter threw straight out of `writeLegacyValue`, out of
 * `setItem`, and PAST `notifyPersistFailure` — so the rancher was never told
 * their edits existed only in memory, and lost them on the next reload.
 * `removeLegacyValue` had the same hole.
 *
 * Guarding those two call sites would have left the trap set for the third. A
 * function that cannot throw cannot be called wrongly.
 *
 * Three states rather than two, because "absent" and "blocked" are different
 * answers and `readLegacyValue` is built on telling them apart: no storage API
 * is an absence with nothing to have lost, while a blocked one is a read that
 * FAILED.
 */
type BrowserStorageAccess = 'available' | 'absent' | 'blocked';

function browserStorageAccess(): BrowserStorageAccess {
  if (typeof window === 'undefined') return 'absent';

  try {
    return typeof window.localStorage === 'undefined' ? 'absent' : 'available';
  } catch {
    return 'blocked';
  }
}

/*
 * Reports whether the read FAILED, not just what it found.
 *
 * `null` from this function used to mean both "no legacy value" and "the read
 * threw", and the caller could not tell them apart — which is the same
 * conflation `workspaceReadFailure` exists to resolve one storage layer up.
 *
 * The blocked-storage case is now answered by `browserStorageAccess` above
 * rather than by a try around the availability check here. Same outcome for
 * this function, and it closes the same hole in the write and remove paths,
 * which never had the try.
 */
function readLegacyValue(name: string): { value: string | null; failed: boolean } {
  const access = browserStorageAccess();

  // No storage API at all — server-side rendering, a stripped embedder. That is
  // an absence, not a failure: there is nothing here to have lost.
  if (access === 'absent') return { value: null, failed: false };

  // Blocked is the opposite: storage exists and we were refused, so what it
  // holds is unknown rather than empty.
  if (access === 'blocked') {
    console.error('Reading the legacy workspace value failed.', 'localStorage access is blocked.');
    return { value: null, failed: true };
  }

  try {
    return { value: window.localStorage.getItem(name), failed: false };
  } catch (error) {
    console.error('Reading the legacy workspace value failed.', error);
    return { value: null, failed: true };
  }
}

function writeLegacyValue(name: string, value: string): boolean {
  // Blocked and absent both mean "not written", which is what the caller acts
  // on — and it has to be a RETURN rather than a throw, because the caller's
  // next move is to tell the rancher.
  if (browserStorageAccess() !== 'available') {
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

/*
 * A note that the fallback is AHEAD of the primary store.
 *
 * `setItem` already does the right thing when IndexedDB refuses a write: the
 * value goes to localStorage instead. The read path did not know that had
 * happened. It returned the first truthy IndexedDB value it found, which after
 * such a refusal is the OLDER copy — so the app hydrated stale records, and
 * the next successful write then removed the newer fallback. Every edit made
 * during the outage disappeared with nothing on screen having said a word.
 *
 * Nothing in the stored value carries a clock to compare, so this records the
 * ordering at the one moment it is actually known: when the fallback write
 * happens because the primary one failed. It lives in localStorage because
 * IndexedDB is the store that just proved unreliable.
 */
const FALLBACK_AHEAD_PREFIX = 'xbar-workspace-fallback-ahead:';

/**
 * Record — or clear — that the fallback holds the newer workspace.
 *
 * Reports whether it took. Swallowing the failure was safe for the CLEARING
 * direction and quietly destructive for the setting one: a fallback write can
 * succeed and then leave no room for the marker, and without the marker the
 * read path cannot tell the fallback is newer. The next load returns the older
 * primary copy as authoritative and the write after that overwrites the newer
 * one. So the caller is told, and decides.
 */
function markFallbackAhead(name: string, ahead: boolean): boolean {
  if (browserStorageAccess() !== 'available') return false;
  try {
    if (ahead) window.localStorage.setItem(FALLBACK_AHEAD_PREFIX + name, '1');
    else window.localStorage.removeItem(FALLBACK_AHEAD_PREFIX + name);
    return true;
  } catch {
    return false;
  }
}

/*
 * Three answers, not two.
 *
 * A boolean forced an unreadable marker to mean "no fallback is ahead", which
 * is the one thing it cannot mean: the marker and the fallback live in the SAME
 * store, so a refusal to read hides both at once. The stale primary then looked
 * authoritative, hydration was declared resolved, and the next successful write
 * overwrote the newer copy — losing exactly the edits the outage had stranded
 * there, permanently.
 *
 * `absent` is genuinely 'no': with no localStorage at all, no fallback was ever
 * written. `blocked` and a thrown read are 'unknown', matching the distinction
 * readLegacyValue already draws.
 */
type FallbackAhead = 'yes' | 'no' | 'unknown';

function fallbackAheadState(name: string): FallbackAhead {
  const access = browserStorageAccess();
  if (access === 'absent') return 'no';
  if (access === 'blocked') return 'unknown';
  try {
    return window.localStorage.getItem(FALLBACK_AHEAD_PREFIX + name) !== null ? 'yes' : 'no';
  } catch {
    return 'unknown';
  }
}

function removeLegacyValue(name: string) {
  if (browserStorageAccess() !== 'available') {
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

/*
 * Every persisted collection that holds records a rancher entered.
 *
 * This was a hand-written subset naming seven of the fourteen collections
 * `partialize` writes, and the seven it omitted are not obscure: a workspace
 * whose only records are expense receipts, ranch assets, ownership records,
 * sales leads, shared listings or audit events read as EMPTY. Both guards
 * below then stood down and let a partial in-memory state overwrite the lot —
 * the exact accident they exist to stop, reached through a gap in the list
 * rather than a gap in the logic.
 *
 * `roleWorkspaces` is deliberately NOT here, and this is the whole reason the
 * list is not simply "every persisted array". It is seeded from `roleSeed`, so
 * it is non-empty on a fresh install and on every workspace that has ever
 * existed. Counting it would make `hasMeaningfulPersistedWorkspace` answer
 * `true` for absolutely everything — including the empty initial state — so
 * `!hasMeaningfulPersistedWorkspace(nextValue)` could never be true and BOTH
 * guards would be silently disabled. Completing the list the obvious way would
 * have removed the protection it was meant to complete.
 *
 * The other six are all seeded empty (`ownershipSeed`, `expenseReceiptsSeed`,
 * `ranchAssetsSeed`, `salesLeadsSeed`, `sharedListingsSeed` are empty arrays by
 * deliberate comment, and `auditEvents` starts `[]`), so a fresh install still
 * reads as empty and the guard still fires where it should.
 */
export const MEANINGFUL_WORKSPACE_COLLECTIONS = [
  'horses',
  'documents',
  'intakeBatches',
  'ownershipRecords',
  'auditEvents',
  'salePacketBuilds',
  'buyerRoomEvents',
  'expenseReceipts',
  'ranchAssets',
  'salesLeads',
  'sharedListings',
  'workspaceMembers',
  'workspaceInvitations',
] as const;

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
    MEANINGFUL_WORKSPACE_COLLECTIONS.some((collection) => hasItems(workspace, collection)),
  );
}

export function shouldProtectMeaningfulWorkspaceWrite(existingValue: string | null, nextValue: string) {
  return hasMeaningfulPersistedWorkspace(existingValue) && !hasMeaningfulPersistedWorkspace(nextValue);
}

/*
 * Whether a write must be withheld because hydration never read the workspace.
 *
 * `shouldProtectMeaningfulWorkspaceWrite` guards the meaningful-to-EMPTY
 * transition, which is only the first move of the accident. When both stores
 * fail during `getItem`, zustand hydrates the empty initial state; the guard
 * above then correctly refuses to persist that emptiness. But the session
 * continues, and the moment the rancher adds a single horse the in-memory
 * state becomes "meaningful" in its own right — so the guard stops firing and
 * that one-horse state is written over a complete workspace it was never
 * derived from. The protection expired at exactly the wrong moment.
 *
 * The missing question is not what the write CONTAINS, it is what the write is
 * DESCENDED FROM. A state that was never hydrated describes no stored
 * workspace, however full it later becomes.
 *
 * Deliberately narrower than refusing every write while hydration is
 * unresolved. A read can fail on a device with nothing stored — a fresh
 * install in a private window is the ordinary case — and refusing there would
 * mean a first-time user's whole session never saves in order to protect
 * records that do not exist. So a write is withheld only when there is
 * something real to lose:
 *
 * - the reread failed too, so we cannot prove there is nothing there. Absence
 *   of evidence is the case this whole module keeps having to relearn.
 * - the reread succeeded and found a meaningful workspace, which this state
 *   demonstrably did not come from.
 *
 * A withheld write is reported through `notifyPersistFailure`, not swallowed.
 * The work stays in memory and usable; the app simply stops claiming it is
 * saved, which is the same bargain the quota-failure path makes.
 */
export function shouldDeferUnhydratedWorkspaceWrite(
  hydrationReadFailed: boolean,
  existingValue: string | null,
  existingReadFailed: boolean,
) {
  if (!hydrationReadFailed) return false;
  if (existingReadFailed) return true;
  return hasMeaningfulPersistedWorkspace(existingValue);
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
    /*
     * A primary value is authoritative only when nothing says otherwise. After
     * an IndexedDB write refusal the newer workspace is in the fallback, and
     * returning this one hydrates the state the rancher had BEFORE the outage.
     */
    if (indexed.value && fallbackAheadState(name) === 'no') {
      // The workspace was found. Whatever the fallback would have said is moot.
      workspaceReadFailure = false;
      return indexed.value;
    }

    const legacy = readLegacyValue(name);

    if (indexed.value && !legacy.value) {
      /*
       * The marker outlived the value it described — localStorage was cleared,
       * or this is a different browser profile. The primary copy is all there
       * is, so use it and stop claiming the fallback is ahead.
       */
      if (legacy.failed) {
        /*
         * Not "the marker outlived its value" — we were refused. The fallback
         * and its marker share a store, so a newer workspace may be sitting
         * behind that refusal. Serve the primary, because the app has to load
         * something, but leave hydration UNRESOLVED: that is what makes the
         * deferral guard withhold the write that would otherwise overwrite it.
         * Clearing the marker here would be worse still, destroying the only
         * record that the fallback is the newer copy.
         */
        workspaceReadFailure = true;
        return indexed.value;
      }
      markFallbackAhead(name, false);
      workspaceReadFailure = false;
      return indexed.value;
    }

    /*
     * A value from EITHER store resolves hydration.
     *
     * The `indexed.value` branch above already says so; leaving the fallback
     * out of it was an asymmetry, not a decision. A browser that has ever
     * refused an IndexedDB write lives in the fallback, and there the workspace
     * loaded completely while this flag still called hydration unresolved — so
     * the unhydrated-write guard refused every edit that followed. Those
     * ranchers could open their records and never change one: each day's work
     * stayed in memory and vanished on reload.
     *
     * With no value, "absent" requires BOTH stores to have answered. That is
     * the flag's original job: the vault sweep deletes blobs the workspace no
     * longer references, so it must know whether an empty reference set means
     * "fresh install" or "we could not read it". One store saying nothing while
     * the other throws proves neither, and deleting is not reversible.
     */
    workspaceReadFailure = legacy.value ? false : indexed.failed || legacy.failed;

    if (legacy.value) {
      /*
       * The result is acted on, not discarded. IndexedDB can be readable and
       * still refuse a write — an aborted transaction, a full quota — and
       * removing the legacy value anyway deleted the only durable copy of the
       * workspace. A rancher who merely opened and closed the app lost
       * everything on the next load.
       */
      const migrated = await writeIndexedValue(name, legacy.value);
      if (migrated) {
        markFallbackAhead(name, false);
        if (name === LEGACY_KEY) {
          removeLegacyValue(name);
        }
      }
    }

    return legacy.value;
  },
  async setItem(name, value) {
    if (name === LEGACY_KEY) {
      const indexed = await readIndexedValue(name);
      const legacy = indexed.value === null ? readLegacyValue(name) : null;
      const existingValue = indexed.value ?? legacy?.value ?? null;
      /*
       * Deliberately a stricter bar than the flag above, and the difference is
       * not an oversight — the two answer different questions.
       *
       * `workspaceReadFailure` guards an irreversible delete, so ANY doubt has
       * to count. This guards a write, and refusing a write is not free: the
       * refusal lasts the whole session, so demanding the same certainty
       * bricked a browser whose IndexedDB is permanently unreadable. Its
       * fallback answers cleanly every time, hydration is willing to run on
       * that answer, and yet no edit could ever be saved.
       *
       * So a write is blocked on uncertainty only when NO store could answer.
       * A working store reporting "nothing here" is an answer, and the write
       * lands there — it cannot destroy what we just successfully read.
       */
      const existingReadFailed = indexed.value !== null ? false : indexed.failed && (legacy?.failed ?? false);

      if (shouldDeferUnhydratedWorkspaceWrite(workspaceReadFailure, existingValue, existingReadFailed)) {
        // Withheld, not failed silently — the app must stop looking saved.
        notifyPersistFailure(name);
        return;
      }
      if (shouldProtectMeaningfulWorkspaceWrite(existingValue, value)) {
        return;
      }
    }

    const persisted = await writeIndexedValue(name, value);
    if (!persisted) {
      if (writeLegacyValue(name, value)) {
        /*
         * The fallback now holds a newer workspace than the primary store, and
         * the marker is the read path's ONLY way to find that out — so a
         * fallback whose marker did not land is not a saved workspace. It is
         * the exact quota case that makes this likely: the value fits, the
         * marker does not, and the next load then hands back the older primary
         * copy as authoritative and overwrites this one.
         *
         * The value is deliberately left in place rather than rolled back: it
         * is still the newest copy of the workspace, and deleting it to keep
         * the stores tidy would be the loss itself. What changes is that the
         * app stops claiming the write succeeded.
         */
        if (!markFallbackAhead(name, true)) notifyPersistFailure(name);
      } else {
        // Both stores refused. The app carries on with the workspace in memory,
        // which is the right behaviour — losing the current session's work on
        // top of a storage failure helps nobody — but it must not look saved.
        notifyPersistFailure(name);
      }
      return;
    }

    // The primary store has caught up, so it is authoritative again.
    markFallbackAhead(name, false);

    if (name === LEGACY_KEY) {
      removeLegacyValue(name);
    }
  },
  async removeItem(name) {
    await removeIndexedValue(name);
    removeLegacyValue(name);
    markFallbackAhead(name, false);
  },
};

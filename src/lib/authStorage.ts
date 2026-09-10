/*
 * The store auth-js keeps its session in -- supplied by this app rather than
 * chosen by the library, so that this app can READ it.
 *
 * auth-js otherwise picks for itself: localStorage when `supportsLocalStorage()`
 * passes, and a per-tab in-memory store when it does not. Both choices are
 * correct; the problem is that the second one is invisible from here, and the
 * session it holds is the only thing that can say whether a broadcast auth
 * event is about THIS tab. Two attempts to work around that invisibility both
 * failed, in instructive ways:
 *
 *   - guessing from whether localStorage could be read, which is not the test
 *     auth-js applies (it probes a WRITE, so a full quota sends it to memory
 *     while a read still succeeds); and
 *   - asking the client with `getSession()`, which deadlocks: auth-js pushes
 *     the operation holding its lock into the same `pendingInLock` queue that a
 *     nested `_acquireLock` awaits, so a call made from inside an
 *     `onAuthStateChange` callback waits on the operation that is waiting for
 *     that callback to return.
 *
 * Owning the adapter removes the question. The fallback is this module's own
 * Map, so it is readable, synchronous, and needs no lock -- and it is per tab,
 * exactly like the one it replaces.
 */

const memoryStore = new Map<string, string>();

/*
 * auth-js's own probe, matched deliberately: a WRITE and a REMOVE, not a read.
 * Storage that reads but cannot be written -- a full quota is the ordinary way
 * to get there -- is storage auth-js will refuse, and this has to agree with it
 * or the two disagree about where the session lives.
 */
function localStorageUsable(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const probe = 'xbar-auth-storage-probe';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

let sharedMode: boolean | null = null;

/*
 * Whether the session store is shared between tabs.
 *
 * Resolved once and remembered, because auth-js resolves it once: it picks a
 * storage at construction and keeps it. A value that changed later would
 * describe a client that no longer exists.
 */
export function authStorageIsShared(): boolean {
  if (sharedMode === null) sharedMode = localStorageUsable();
  return sharedMode;
}

/* Test seam: forget the resolved mode so a case can choose its own. */
export function resetAuthStorageMode() {
  sharedMode = null;
  memoryStore.clear();
}

export function readAuthStorage(key: string): string | null {
  if (!authStorageIsShared()) return memoryStore.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/*
 * Handed to `createClient` as `auth.storage`. Every write auth-js makes lands
 * somewhere this app can read back, in either mode.
 */
export const authStorageAdapter = {
  getItem(key: string): string | null {
    return readAuthStorage(key);
  },
  setItem(key: string, value: string): void {
    if (!authStorageIsShared()) {
      memoryStore.set(key, value);
      return;
    }
    try {
      localStorage.setItem(key, value);
    } catch {
      // The mode was resolved before the client was built, so a write failing
      // now is a quota that filled since. Keep the value reachable rather than
      // losing the session outright.
      memoryStore.set(key, value);
    }
  },
  removeItem(key: string): void {
    memoryStore.delete(key);
    if (!authStorageIsShared()) return;
    try {
      localStorage.removeItem(key);
    } catch {
      // Already gone from the readable copy above.
    }
  },
};

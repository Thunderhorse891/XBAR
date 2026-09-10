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

/*
 * Not a fallback store -- an OVERLAY, authoritative for any key it holds.
 *
 * The difference is the whole point, and getting it wrong once already cost a
 * defect in the recovery records this mirrors. A write that localStorage
 * refuses still has to be READABLE, or auth-js reports a sign-in that the next
 * read cannot see: the fence then compares the new event against the stale
 * persisted session, disagrees, and discards the sign-in -- leaving the UI on
 * the previous identity, from a write that "failed" silently.
 *
 * So an entry here wins over localStorage, a successful durable write clears
 * it, and a removal localStorage refuses leaves a `null` tombstone rather than
 * letting the old value resurface.
 */
const memoryStore = new Map<string, string | null>();

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
  // The overlay first, in both modes: it holds either the per-tab session or a
  // durable write that failed, and both outrank whatever localStorage still has.
  if (memoryStore.has(key)) return memoryStore.get(key) ?? null;
  if (!authStorageIsShared()) return null;
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
      // Durable now, so the overlay must stop shadowing it.
      memoryStore.delete(key);
    } catch {
      // The mode was resolved before the client was built, so a write failing
      // now is a quota that filled since. Keep it readable rather than losing
      // the session to a write nobody was told about.
      memoryStore.set(key, value);
    }
  },
  removeItem(key: string): void {
    if (!authStorageIsShared()) {
      memoryStore.delete(key);
      return;
    }
    try {
      localStorage.removeItem(key);
      memoryStore.delete(key);
    } catch {
      // A tombstone, not a delete: dropping the entry would let the value
      // localStorage still holds come back as though it had never been removed.
      memoryStore.set(key, null);
    }
  },
};

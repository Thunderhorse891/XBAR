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
 * What localStorage held at the moment a key first fell into the overlay.
 *
 * A key enters the overlay in shared mode only because a durable write was
 * REFUSED -- a quota that filled since the mode was resolved. From that instant
 * this tab is effectively private for that key while still believing it shares
 * one, and the overlay hides the divergence: `readAuthStorage` returns the
 * overlay value, so nothing here can see what the other tabs went on to store.
 *
 * Rejoining blindly when the quota frees is what that costs. Measured on the
 * adapter's own logic:
 *
 *   A refresh, quota full    durable=session-A-v1  tabA reads=session-A-v2
 *   tab B signs in           durable=session-B-v1  tabA reads=session-A-v2
 *   A refresh, quota freed   durable=session-A-v3   <- B's session destroyed
 *
 * and the same through `removeItem`, where A signing out DELETES B's session
 * outright. auth-js then broadcasts the refresh or the sign-out and every other
 * tab reconciles to A, or to nobody.
 *
 * So a diverged key may only rejoin shared storage if shared storage has not
 * moved on: the durable value is compared against what it was when this tab
 * left, and any change at all keeps the tab private. Compared by VALUE rather
 * than by session generation deliberately -- this adapter is generic over keys
 * and has no business decoding tokens, and "anything changed" is the more
 * conservative test of the two.
 */
const divergedAt = new Map<string, string | null>();

/*
 * Records the divergence on the way into the overlay.
 *
 * The anchor must never move to a value another tab wrote while this tab was
 * diverged, or the next successful write would match it and rejoin -- clobbering
 * exactly what this exists to protect. In practice both callers already return
 * early once diverged, so this is never reached with a stale anchor; the guard
 * below keeps that a property of THIS function rather than of its call sites.
 * It is deliberate redundancy and was measured as such: removing it alone
 * changes no observable behaviour.
 */
function markDiverged(key: string) {
  if (divergedAt.has(key)) return;
  try {
    divergedAt.set(key, localStorage.getItem(key));
  } catch {
    divergedAt.set(key, null);
  }
}

/* Whether shared storage still holds what it held when this tab left it. */
function mayRejoinSharedStorage(key: string): boolean {
  if (!divergedAt.has(key)) return true;
  try {
    return localStorage.getItem(key) === (divergedAt.get(key) ?? null);
  } catch {
    return false;
  }
}

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
  divergedAt.clear();
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
    // Already diverged and shared storage has moved on: stay private rather
    // than overwrite the account another tab durably holds.
    if (!mayRejoinSharedStorage(key)) {
      memoryStore.set(key, value);
      return;
    }
    try {
      localStorage.setItem(key, value);
      // Durable now, so the overlay must stop shadowing it -- and this tab is
      // back in step with shared storage, so the divergence is over.
      memoryStore.delete(key);
      divergedAt.delete(key);
    } catch {
      // The mode was resolved before the client was built, so a write failing
      // now is a quota that filled since. Keep it readable rather than losing
      // the session to a write nobody was told about.
      markDiverged(key);
      memoryStore.set(key, value);
    }
  },
  removeItem(key: string): void {
    if (!authStorageIsShared()) {
      memoryStore.delete(key);
      return;
    }
    /*
     * The same rule, and it matters more here: a sign-out that rejoined would
     * not merely replace another tab's session, it would DELETE it, signing out
     * an account this tab never had.
     */
    if (!mayRejoinSharedStorage(key)) {
      memoryStore.set(key, null);
      return;
    }
    try {
      localStorage.removeItem(key);
      memoryStore.delete(key);
      divergedAt.delete(key);
    } catch {
      // A tombstone, not a delete: dropping the entry would let the value
      // localStorage still holds come back as though it had never been removed.
      markDiverged(key);
      memoryStore.set(key, null);
    }
  },
};

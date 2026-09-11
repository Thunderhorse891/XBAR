import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authStorageAdapter,
  authStorageIsShared,
  readAuthStorage,
  resetAuthStorageMode,
} from '../src/lib/authStorage.js';

/*
 * A localStorage that can be told to refuse individual operations, which is the
 * shape that matters here: the ordinary failures are partial, not total. A
 * quota fills and writes start throwing while reads keep working, and that gap
 * is exactly where a session goes missing.
 */
function installLocalStorage(options: { failWrites?: boolean; failRemoves?: boolean; absent?: boolean } = {}) {
  const backing = new Map<string, string>();
  if (options.absent) {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage is not available');
      },
    });
    return backing;
  }
  const store = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      // The probe must still pass, or the adapter picks per-tab mode and the
      // case stops describing shared storage at all.
      if (options.failWrites && !key.includes('probe')) throw new Error('QuotaExceededError');
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      if (options.failRemoves && !key.includes('probe')) throw new Error('SecurityError');
      backing.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store });
  return backing;
}

function clearLocalStorage() {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
  resetAuthStorageMode();
}

test('a usable localStorage means the tabs share a session', () => {
  installLocalStorage();
  resetAuthStorageMode();
  assert.equal(authStorageIsShared(), true);
  clearLocalStorage();
});

test('storage that reads but cannot be written is not shared', () => {
  /*
   * auth-js probes a WRITE, so this is the mode it would pick. Answering
   * "shared" here would put the two of us in different stores.
   */
  installLocalStorage({ failWrites: true });
  resetAuthStorageMode();
  // The probe itself is refused, which is how auth-js decides.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    },
  });
  resetAuthStorageMode();
  assert.equal(authStorageIsShared(), false);
  clearLocalStorage();
});

test('an unreachable localStorage keeps the session per tab', () => {
  installLocalStorage({ absent: true });
  resetAuthStorageMode();
  assert.equal(authStorageIsShared(), false);
  authStorageAdapter.setItem('sb-x-auth-token', 'session-a');
  assert.equal(readAuthStorage('sb-x-auth-token'), 'session-a');
  authStorageAdapter.removeItem('sb-x-auth-token');
  assert.equal(readAuthStorage('sb-x-auth-token'), null);
  clearLocalStorage();
});

test('a durable write is readable and leaves nothing shadowing it', () => {
  const backing = installLocalStorage();
  resetAuthStorageMode();
  authStorageAdapter.setItem('sb-x-auth-token', 'session-a');
  assert.equal(backing.get('sb-x-auth-token'), 'session-a');
  assert.equal(readAuthStorage('sb-x-auth-token'), 'session-a');
  clearLocalStorage();
});

test('a write localStorage refuses is still readable back', () => {
  /*
   * The defect this exists for. auth-js reported a sign-in, the write was
   * refused by a quota that filled after the probe passed, and the next read
   * returned the STALE session -- so the fence compared the new event against
   * the old identity, disagreed, and discarded the sign-in the customer had
   * just completed.
   */
  const backing = installLocalStorage();
  resetAuthStorageMode();
  authStorageAdapter.setItem('sb-x-auth-token', 'session-a');
  installLocalStorage({ failWrites: true });
  backing.set('sb-x-auth-token', 'session-a');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (key === 'sb-x-auth-token' ? 'session-a' : null),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    },
  });

  authStorageAdapter.setItem('sb-x-auth-token', 'session-b');
  assert.equal(readAuthStorage('sb-x-auth-token'), 'session-b');
  clearLocalStorage();
});

test('a removal localStorage refuses does not let the old session come back', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (key === 'sb-x-auth-token' ? 'session-a' : null),
      setItem: () => {},
      removeItem: (key: string) => {
        if (!key.includes('probe')) throw new Error('SecurityError');
      },
    },
  });
  resetAuthStorageMode();
  assert.equal(authStorageIsShared(), true);

  authStorageAdapter.removeItem('sb-x-auth-token');
  // A tombstone, not a delete: the value localStorage still holds must not
  // resurface as though the sign-out never happened.
  assert.equal(readAuthStorage('sb-x-auth-token'), null);
  clearLocalStorage();
});

/*
 * A localStorage whose quota can fill and free DURING a case, which the helper
 * above cannot express -- it fixes the failure mode at install time, and the
 * defect below only exists in the transition.
 */
function installTogglableLocalStorage() {
  const backing = new Map<string, string>();
  const state = { failWrites: false };
  const store = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (state.failWrites && !key.includes('probe')) throw new Error('QuotaExceededError');
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      if (state.failWrites && !key.includes('probe')) throw new Error('QuotaExceededError');
      backing.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store });
  resetAuthStorageMode();
  return { backing, state };
}

const AUTH_KEY = 'sb-project-auth-token';

test('a tab that fell into the overlay does not overwrite an account stored since', () => {
  /*
   * A key enters the overlay in shared mode only because a durable write was
   * refused, and from that instant the tab is effectively private while still
   * believing it shares a store -- the overlay hides what the other tabs went
   * on to write. Rejoining when the quota frees destroys it:
   *
   *   A refresh, quota full    durable=session-A-v1  tabA reads=session-A-v2
   *   tab B signs in           durable=session-B-v1  tabA reads=session-A-v2
   *   A refresh, quota freed   durable=session-A-v3   <- B's session destroyed
   *
   * auth-js then broadcasts the refresh and every other tab reconciles to A.
   */
  const { backing, state } = installTogglableLocalStorage();
  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v1');
  assert.equal(backing.get(AUTH_KEY), 'session-A-v1');

  state.failWrites = true;
  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v2');
  assert.equal(backing.get(AUTH_KEY), 'session-A-v1', 'the refused write must not have landed');
  assert.equal(readAuthStorage(AUTH_KEY), 'session-A-v2', 'but it must still be readable here');

  // Another tab signs in as a different account, durably.
  state.failWrites = false;
  backing.set(AUTH_KEY, 'session-B-v1');

  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v3');
  assert.equal(backing.get(AUTH_KEY), 'session-B-v1', "account B's durable session must survive");
  assert.equal(readAuthStorage(AUTH_KEY), 'session-A-v3', 'this tab keeps its own session, privately');
  clearLocalStorage();
});

test('a diverged tab signing out does not sign out the account stored since', () => {
  // Worse than a replacement: rejoining here DELETES a session this tab never
  // had, and auth-js broadcasts the sign-out to every other tab.
  const { backing, state } = installTogglableLocalStorage();
  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v1');
  state.failWrites = true;
  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v2');
  state.failWrites = false;
  backing.set(AUTH_KEY, 'session-B-v1');

  authStorageAdapter.removeItem(AUTH_KEY);
  assert.equal(backing.get(AUTH_KEY), 'session-B-v1', 'account B must stay signed in');
  assert.equal(readAuthStorage(AUTH_KEY), null, 'this tab is signed out, privately');
  clearLocalStorage();
});

test('a diverged tab rejoins shared storage when nothing else wrote', () => {
  /*
   * The cost of being conservative has to stay bounded. A transient quota with
   * no competing tab is the ordinary case, and that session must become durable
   * again -- otherwise a reload signs the customer out for no reason.
   */
  const { backing, state } = installTogglableLocalStorage();
  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v1');
  state.failWrites = true;
  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v2');
  state.failWrites = false;

  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v3');
  assert.equal(backing.get(AUTH_KEY), 'session-A-v3', 'nobody else moved, so this may rejoin');
  assert.equal(readAuthStorage(AUTH_KEY), 'session-A-v3');

  // And having rejoined, it is no longer diverged: an ordinary later write
  // stays durable rather than falling back into the overlay for good.
  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v4');
  assert.equal(backing.get(AUTH_KEY), 'session-A-v4');
  clearLocalStorage();
});

test('a tab that stays diverged across repeated failures still protects the other account', () => {
  /*
   * The guard has to hold for as long as the quota does, not just for the first
   * write after it frees. Here account B lands durably while this tab is still
   * being refused, the tab is refused again, and only then does the quota free.
   *
   * Note on what this does NOT prove: `markDiverged`'s own "record once" check
   * is redundant, because both adapter methods return early once diverged and
   * never reach it with a stale anchor. Removing that check alone leaves every
   * case here green -- it is kept as local redundancy, not load-bearing logic,
   * and the comment on it says so.
   */
  const { backing, state } = installTogglableLocalStorage();
  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v1');
  state.failWrites = true;
  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v2');

  backing.set(AUTH_KEY, 'session-B-v1');
  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v3');

  state.failWrites = false;
  authStorageAdapter.setItem(AUTH_KEY, 'session-A-v4');
  assert.equal(backing.get(AUTH_KEY), 'session-B-v1', "B's session must still survive");
  assert.equal(readAuthStorage(AUTH_KEY), 'session-A-v4', 'and this tab keeps its own, privately');
  clearLocalStorage();
});

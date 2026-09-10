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

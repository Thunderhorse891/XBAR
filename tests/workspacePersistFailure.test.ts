import assert from 'node:assert/strict';
import test from 'node:test';

import { didWorkspaceReadFail, onWorkspacePersistFailure, workspaceStateStorage } from '../src/lib/workspaceStorage.js';
import { installFakeIndexedDb } from './helpers/fakeIndexedDb.js';

/*
 * The workspace could fail to save and say nothing.
 *
 * zustand's persist middleware discards whatever `setItem` returns, and the
 * localStorage fallback swallowed its own quota error, so a browser that could
 * not write looked exactly like one that had. A rancher entering a day of
 * records in a private window would lose all of it on reload, with nothing
 * having said a word.
 */

/** A localStorage that refuses every write, the way a full or blocked one does. */
function installBrokenLocalStorage() {
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    },
  };
  return () => {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previous;
  };
}

test('a workspace that cannot be written anywhere is reported', async () => {
  // Both stores refuse: IndexedDB is absent, localStorage throws.
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  const restoreWindow = installBrokenLocalStorage();

  const failures: string[] = [];
  const unsubscribe = onWorkspacePersistFailure((failure) => failures.push(failure.name));

  try {
    await workspaceStateStorage.setItem('xbar-live-workspace', JSON.stringify({ state: { horses: [{ id: 'h1' }] } }));
    assert.deepEqual(failures, ['xbar-live-workspace'], 'the failure must reach a listener');
  } finally {
    unsubscribe();
    restoreWindow();
  }
});

test('a write that succeeds reports nothing', async () => {
  const restoreDb = installFakeIndexedDb();
  const failures: string[] = [];
  const unsubscribe = onWorkspacePersistFailure((failure) => failures.push(failure.name));

  try {
    await workspaceStateStorage.setItem('xbar-live-workspace', JSON.stringify({ state: { horses: [{ id: 'h1' }] } }));
    // A false alarm on every successful save would train the rancher to ignore
    // the one that matters.
    assert.deepEqual(failures, []);
  } finally {
    unsubscribe();
    restoreDb();
  }
});

test('unsubscribing stops the reports', async () => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  const restoreWindow = installBrokenLocalStorage();

  const failures: string[] = [];
  const unsubscribe = onWorkspacePersistFailure((failure) => failures.push(failure.name));
  unsubscribe();

  try {
    await workspaceStateStorage.setItem('xbar-live-workspace', '{}');
    assert.deepEqual(failures, []);
  } finally {
    restoreWindow();
  }
});

test('one broken listener does not stop the others, or the write path', async () => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  const restoreWindow = installBrokenLocalStorage();

  const seen: string[] = [];
  const unsubscribeBroken = onWorkspacePersistFailure(() => {
    throw new Error('listener exploded');
  });
  const unsubscribeGood = onWorkspacePersistFailure(() => seen.push('good'));

  try {
    // Must not reject: this is the reporting path for a storage failure, and it
    // is reached from inside a state update. Throwing here would turn a failure
    // to SAVE into a failure to EDIT.
    await workspaceStateStorage.setItem('xbar-live-workspace', '{}');
    assert.deepEqual(seen, ['good']);
  } finally {
    unsubscribeBroken();
    unsubscribeGood();
    restoreWindow();
  }
});

test('a write rolled back at commit is a failure, not a save', async () => {
  // The put succeeds and the transaction then aborts, which is what a browser
  // out of quota actually does. Resolving on the request made
  // `writeIndexedValue` return true for a write that never landed, so both the
  // localStorage fallback AND the failure notice were skipped: the workspace
  // looked saved and was gone on reload.
  const restoreDb = installFakeIndexedDb({ abortOnCommit: true });
  const restoreWindow = installBrokenLocalStorage();

  const failures: string[] = [];
  const unsubscribe = onWorkspacePersistFailure((failure) => failures.push(failure.name));

  try {
    await workspaceStateStorage.setItem('xbar-live-workspace', JSON.stringify({ state: { horses: [{ id: 'h1' }] } }));
    assert.deepEqual(failures, ['xbar-live-workspace'], 'a rolled-back write must be reported');
  } finally {
    unsubscribe();
    restoreWindow();
    restoreDb();
  }
});

test('a failed read is distinguishable from an empty workspace', async () => {
  // Both are `null`, and telling them apart is what stops the file-vault sweep
  // deleting every stored document after a transient read failure.
  const restoreWorking = installFakeIndexedDb();
  try {
    await workspaceStateStorage.getItem('xbar-live-workspace');
    assert.equal(didWorkspaceReadFail(), false, 'nothing stored is not a failure');
  } finally {
    restoreWorking();
  }

  const restoreBroken = installFakeIndexedDb({ abortWrites: true });
  try {
    await workspaceStateStorage.getItem('xbar-live-workspace');
    assert.equal(didWorkspaceReadFail(), true, 'a read that threw must be recorded as a failure');
  } finally {
    restoreBroken();
  }
});

/*
 * A localStorage whose reads throw, which is the failure the fallback path had
 * no way to report. `getItem` is separated from the `localStorage` getter
 * deliberately: browsers configured to block site data throw from the GETTER,
 * so `typeof window.localStorage` throws before any method is reached — and
 * that path escaped the module's try/catch entirely.
 */
function installHostileLocalStorage(where: 'getter' | 'getItem') {
  const previous = (globalThis as { window?: unknown }).window;
  const win: Record<string, unknown> = {};

  if (where === 'getter') {
    Object.defineProperty(win, 'localStorage', {
      get() {
        throw new Error('SecurityError: access to storage is not allowed from this context');
      },
      configurable: true,
    });
  } else {
    win.localStorage = {
      getItem: () => {
        throw new Error('storage read failed');
      },
      setItem: () => {},
      removeItem: () => {},
    };
  }

  (globalThis as { window?: unknown }).window = win;
  return () => {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previous;
  };
}

/** A working localStorage holding a workspace IndexedDB does not have. */
function installLocalStorageWith(entries: Record<string, string>) {
  const previous = (globalThis as { window?: unknown }).window;
  const store = new Map(Object.entries(entries));
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  };
  return () => {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previous;
  };
}

for (const where of ['getItem', 'getter'] as const) {
  test(`a fallback read that throws from the ${where} is a failure, not an empty workspace`, async () => {
    /*
     * The case the IndexedDB-only flag could not see.
     *
     * A workspace that lives ONLY in localStorage is not exotic — it is where
     * every browser that has ever refused an IndexedDB write ends up, since
     * `setItem` falls back to localStorage and leaves the primary store empty.
     * On the next load the IndexedDB read then SUCCEEDS and returns nothing,
     * which used to clear the failure flag before the fallback was even tried.
     *
     * If the fallback read then throws, hydration installs the empty initial
     * state while `didWorkspaceReadFail()` reports false — and the settled
     * sweep deletes every local-owned document, receipt and packet in the
     * vault as unreferenced, permanently, on a start-up that would have
     * recovered as soon as localStorage came back.
     */
    const restoreDb = installFakeIndexedDb();
    const restoreWindow = installHostileLocalStorage(where);

    try {
      const value = await workspaceStateStorage.getItem('xbar-live-workspace');
      assert.equal(value, null, 'a failed read still has nothing to return');
      assert.equal(
        didWorkspaceReadFail(),
        true,
        'an empty primary read plus a throwing fallback proves nothing about whether a workspace exists',
      );
    } finally {
      restoreWindow();
      restoreDb();
    }
  });
}

test('a workspace found only in the fallback is returned and is not a failure', async () => {
  // The other half of the same branch: the fallback answering successfully is
  // the normal path for these browsers, and must not be reported as a failure.
  const stored = JSON.stringify({ state: { horses: [{ id: 'h1' }] } });
  const restoreDb = installFakeIndexedDb();
  const restoreWindow = installLocalStorageWith({ 'xbar-live-workspace': stored });

  try {
    const value = await workspaceStateStorage.getItem('xbar-live-workspace');
    assert.equal(value, stored, 'the fallback workspace must still hydrate');
    assert.equal(didWorkspaceReadFail(), false, 'a fallback that answered is not a failure');
  } finally {
    restoreWindow();
    restoreDb();
  }
});

test('a write does not clear a failure the read recorded', async () => {
  /*
   * `setItem` reads the existing value to protect a meaningful workspace from
   * being overwritten by an empty one, and that read used to set the same flag
   * hydration had just set. The sweep is deferred until the workspace settles —
   * after cloud reconciliation — so an ordinary autosave in between could flip
   * the flag back to false and re-enable exactly the sweep it was meant to stop.
   */
  const restoreDb = installFakeIndexedDb({ abortWrites: true });
  const restoreWindow = installHostileLocalStorage('getItem');
  try {
    await workspaceStateStorage.getItem('xbar-live-workspace');
    assert.equal(didWorkspaceReadFail(), true, 'precondition: the read failed');
  } finally {
    restoreWindow();
    restoreDb();
  }

  const restoreWorkingDb = installFakeIndexedDb();
  const restoreWorkingWindow = installLocalStorageWith({});
  try {
    await workspaceStateStorage.setItem('xbar-live-workspace', JSON.stringify({ state: { horses: [{ id: 'h1' }] } }));
    assert.equal(didWorkspaceReadFail(), true, 'only a read may decide whether the workspace was readable');
  } finally {
    restoreWorkingWindow();
    restoreWorkingDb();
  }
});

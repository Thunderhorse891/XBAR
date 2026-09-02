import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  MEANINGFUL_WORKSPACE_COLLECTIONS,
  didWorkspaceReadFail,
  hasMeaningfulPersistedWorkspace,
  onWorkspacePersistFailure,
  shouldDeferUnhydratedWorkspaceWrite,
  shouldProtectMeaningfulWorkspaceWrite,
  workspaceStateStorage,
} from '../src/lib/workspaceStorage.js';
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

/*
 * The write half of the same hole, and the one that actually loses work.
 *
 * `setItem` falls back to localStorage when IndexedDB refuses, and reports the
 * failure only when that fallback returns false. The availability check sat
 * OUTSIDE the try, so a browser blocking site data threw from the
 * `window.localStorage` getter, straight out of `writeLegacyValue`, out of
 * `setItem`, and past `notifyPersistFailure` — the rancher was never told their
 * edits existed only in memory, and lost them on the next reload.
 *
 * The read path had been fixed for exactly this and the write path had not,
 * which is why the accessor now cannot throw at all.
 */
test('a blocked storage getter is reported as a persist failure, not thrown', async () => {
  const restoreDb = installFakeIndexedDb({ abortWrites: true });
  const restoreWindow = installHostileLocalStorage('getter');
  const failures: string[] = [];
  const unsubscribe = onWorkspacePersistFailure((failure) => failures.push(failure.name));

  try {
    // Must not reject. A throw here is the bug: it skips the notification below.
    await workspaceStateStorage.setItem('xbar-live-workspace', JSON.stringify({ state: { horses: [] } }));
    assert.deepEqual(failures, ['xbar-live-workspace'], 'both stores refused, so the rancher must be told');
  } finally {
    unsubscribe();
    restoreWindow();
    restoreDb();
  }
});

/*
 * And removal, which had the same unguarded check. Nothing to report here — the
 * value is already gone from the primary store — but it must not throw out of
 * `removeItem` either.
 */
test('a blocked storage getter does not throw out of removeItem', async () => {
  const restoreDb = installFakeIndexedDb();
  const restoreWindow = installHostileLocalStorage('getter');

  try {
    await workspaceStateStorage.removeItem('xbar-live-workspace');
  } finally {
    restoreWindow();
    restoreDb();
  }
});

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

/*
 * The workspace could be overwritten by a session that never read it.
 *
 * `shouldProtectMeaningfulWorkspaceWrite` guards the meaningful-to-empty
 * transition, and that is only the first move. After a failed hydration the
 * empty initial state is correctly refused — but the session carries on, and
 * one added horse makes the in-memory state "meaningful" in its own right. The
 * guard stops firing, and a one-horse state lands on top of a complete
 * workspace it was never derived from.
 */

const COMPLETE_WORKSPACE = JSON.stringify({
  state: {
    horses: [{ id: 'h1' }, { id: 'h2' }],
    documents: [{ id: 'd1' }],
    workspaceProfile: { ranchName: 'Blue River Ranch', setupCompleteAt: '2026-06-27 09:00' },
  },
});

/** What the rancher has after adding one horse to a workspace that never loaded. */
const PARTIAL_WORKSPACE = JSON.stringify({ state: { horses: [{ id: 'h3' }] } });

test('a write from a state that never hydrated cannot replace the stored workspace', async () => {
  let readsFail = false;
  const restoreDb = installFakeIndexedDb({ failReads: () => readsFail });
  const restoreWindow = installLocalStorageWith({});
  const failures: string[] = [];
  const unsubscribe = onWorkspacePersistFailure((failure) => failures.push(failure.name));

  try {
    await workspaceStateStorage.setItem('xbar-live-workspace', COMPLETE_WORKSPACE);
    assert.equal(
      await workspaceStateStorage.getItem('xbar-live-workspace'),
      COMPLETE_WORKSPACE,
      'precondition: a real workspace is on the device',
    );
    assert.equal(didWorkspaceReadFail(), false, 'precondition: that read succeeded');

    // Hydration cannot read it, so zustand hydrates the empty initial state.
    readsFail = true;
    assert.equal(await workspaceStateStorage.getItem('xbar-live-workspace'), null);
    assert.equal(didWorkspaceReadFail(), true, 'precondition: hydration failed');

    // Storage recovers and the rancher adds a horse. This is the write that
    // used to destroy everything: the guard above sees a meaningful next value
    // and stands down.
    readsFail = false;
    await workspaceStateStorage.setItem('xbar-live-workspace', PARTIAL_WORKSPACE);

    assert.equal(
      await workspaceStateStorage.getItem('xbar-live-workspace'),
      COMPLETE_WORKSPACE,
      'the stored workspace must survive a write from a state that never read it',
    );
    assert.deepEqual(failures, ['xbar-live-workspace'], 'and the app must stop claiming the work is saved');
  } finally {
    unsubscribe();
    restoreWindow();
    restoreDb();
  }
});

test('a write is withheld while NO store can say what is on the device', async () => {
  /*
   * The worse shape of the same accident: storage never recovers, so the write
   * path still works while the read path does not. Without the guard the
   * partial state is written over the complete one, and the reread that would
   * have objected is the very thing that is broken.
   *
   * Both stores have to be unreadable for that to be the situation. A working
   * fallback saying "nothing here" is an answer, and blocking on it is what
   * bricked every edit in a browser whose IndexedDB is permanently unreadable —
   * see the fallback test below.
   */
  let readsFail = false;
  const restoreDb = installFakeIndexedDb({ failReads: () => readsFail });
  const restoreSeedWindow = installLocalStorageWith({});
  try {
    await workspaceStateStorage.setItem('xbar-live-workspace', COMPLETE_WORKSPACE);
  } finally {
    restoreSeedWindow();
  }

  readsFail = true;
  const restoreWindow = installHostileLocalStorage('getItem');
  try {
    await workspaceStateStorage.getItem('xbar-live-workspace');
    assert.equal(didWorkspaceReadFail(), true, 'precondition: neither store could answer');

    await workspaceStateStorage.setItem('xbar-live-workspace', PARTIAL_WORKSPACE);
  } finally {
    restoreWindow();
  }

  readsFail = false;
  const restoreReadWindow = installLocalStorageWith({});
  try {
    assert.equal(
      await workspaceStateStorage.getItem('xbar-live-workspace'),
      COMPLETE_WORKSPACE,
      'a write must not proceed when nothing could say what it would replace',
    );
  } finally {
    restoreReadWindow();
    restoreDb();
  }
});

test('a fallback-only browser can still save its edits', async () => {
  /*
   * The regression this guard introduced, and the reason the bar for blocking a
   * write is stricter than the bar for the vault sweep.
   *
   * A browser that has ever refused an IndexedDB write lives in the
   * localStorage fallback. Hydration there loads the workspace COMPLETELY — it
   * just loads it from the other store — but the read-failure flag counted the
   * IndexedDB failure anyway, so every edit that followed was refused. The
   * rancher could open every record and change none: the day's work stayed in
   * memory and vanished on reload.
   */
  const restoreDb = installFakeIndexedDb({ failReads: () => true });
  const restoreWindow = installLocalStorageWith({ 'xbar-live-workspace': COMPLETE_WORKSPACE });
  const failures: string[] = [];
  const unsubscribe = onWorkspacePersistFailure((failure) => failures.push(failure.name));

  try {
    assert.equal(
      await workspaceStateStorage.getItem('xbar-live-workspace'),
      COMPLETE_WORKSPACE,
      'precondition: the fallback hydrated the workspace completely',
    );
    assert.equal(didWorkspaceReadFail(), false, 'a value from either store resolves hydration');

    await workspaceStateStorage.setItem('xbar-live-workspace', PARTIAL_WORKSPACE);
    assert.deepEqual(failures, [], 'a fallback-only browser must not be told its work was refused');
  } finally {
    unsubscribe();
    restoreWindow();
    restoreDb();
  }
});

test('a first session saves even where one store is permanently unreadable', async () => {
  /*
   * The other half of the same brick. Nothing is stored, IndexedDB never
   * becomes readable, and the fallback answers "nothing here" every time.
   * Hydration is willing to run on that answer, so the write path must be too —
   * otherwise a first-time user on that browser loses every session forever.
   */
  const restoreDb = installFakeIndexedDb({ failReads: () => true });
  const restoreWindow = installLocalStorageWith({});
  const failures: string[] = [];
  const unsubscribe = onWorkspacePersistFailure((failure) => failures.push(failure.name));

  try {
    assert.equal(await workspaceStateStorage.getItem('xbar-live-workspace'), null);
    assert.equal(didWorkspaceReadFail(), true, 'precondition: a store failed and nothing was found');

    await workspaceStateStorage.setItem('xbar-live-workspace', PARTIAL_WORKSPACE);
    assert.deepEqual(failures, [], 'a working store reporting empty is an answer, not uncertainty');
  } finally {
    unsubscribe();
    restoreWindow();
    restoreDb();
  }
});

test('a first-time workspace still saves after a read failure with nothing stored', async () => {
  /*
   * The over-rejection direction, and the reason this guard is narrower than
   * "refuse every write while hydration is unresolved". A read can fail on a
   * device with nothing stored — a fresh install in a private window is the
   * ordinary case — and refusing there would throw away a first-time user's
   * entire session to protect records that do not exist.
   */
  let readsFail = true;
  const restoreDb = installFakeIndexedDb({ failReads: () => readsFail });
  const restoreWindow = installLocalStorageWith({});
  const failures: string[] = [];
  const unsubscribe = onWorkspacePersistFailure((failure) => failures.push(failure.name));

  try {
    assert.equal(await workspaceStateStorage.getItem('xbar-live-workspace'), null);
    assert.equal(didWorkspaceReadFail(), true, 'precondition: the read failed');

    readsFail = false;
    await workspaceStateStorage.setItem('xbar-live-workspace', PARTIAL_WORKSPACE);

    assert.equal(
      await workspaceStateStorage.getItem('xbar-live-workspace'),
      PARTIAL_WORKSPACE,
      'a first session must still save when there was nothing to lose',
    );
    assert.deepEqual(failures, [], 'and it must not be told its work was refused');
  } finally {
    unsubscribe();
    restoreWindow();
    restoreDb();
  }
});

test('an ordinary session is untouched by the unhydrated-write guard', () => {
  // The flag is what gates this. With hydration resolved, nothing changes —
  // including the meaningful-to-empty protection, which still owns that case.
  assert.equal(shouldDeferUnhydratedWorkspaceWrite(false, COMPLETE_WORKSPACE, false), false);
  assert.equal(shouldDeferUnhydratedWorkspaceWrite(false, null, true), false);

  assert.equal(shouldDeferUnhydratedWorkspaceWrite(true, COMPLETE_WORKSPACE, false), true);
  assert.equal(shouldDeferUnhydratedWorkspaceWrite(true, null, true), true);
  assert.equal(shouldDeferUnhydratedWorkspaceWrite(true, null, false), false);
});

/*
 * The guards were complete and the LIST was not.
 *
 * `hasMeaningfulPersistedWorkspace` named seven of the fourteen collections
 * `partialize` persists, so a workspace whose only records were expense
 * receipts, ranch assets, ownership records, sales leads, shared listings or
 * audit events read as empty — and both guards then stood down and let a
 * partial in-memory state overwrite it. A gap in a hand-written list, not a
 * gap in the logic, which is why the test below checks the list against its
 * source rather than restating it.
 */

const PERSISTED_ONLY_RECEIPTS = JSON.stringify({
  state: { expenseReceipts: [{ id: 'r1', amount: 400 }], horses: [], documents: [] },
});

test('a workspace of only receipts is not an empty workspace', async () => {
  let readsFail = false;
  const restoreDb = installFakeIndexedDb({ failReads: () => readsFail });
  const restoreWindow = installLocalStorageWith({});

  try {
    await workspaceStateStorage.setItem('xbar-live-workspace', PERSISTED_ONLY_RECEIPTS);

    // Hydration fails, the app starts empty, then storage recovers and the
    // rancher adds a horse. Before the list was completed, both guards saw
    // "empty" on the stored side and let this through.
    readsFail = true;
    await workspaceStateStorage.getItem('xbar-live-workspace');
    assert.equal(didWorkspaceReadFail(), true, 'precondition: hydration failed');

    readsFail = false;
    await workspaceStateStorage.setItem('xbar-live-workspace', PARTIAL_WORKSPACE);

    assert.equal(
      await workspaceStateStorage.getItem('xbar-live-workspace'),
      PERSISTED_ONLY_RECEIPTS,
      'a year of spend records is a workspace worth protecting',
    );
  } finally {
    restoreWindow();
    restoreDb();
  }
});

test('the meaningful-collection list covers everything persisted, except the seeded one', async () => {
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  const types = await readFile('src/store/xbarStoreTypes.ts', 'utf8');

  /*
   * The persisted set is read from `partialize` itself and the array-ness from
   * the store's own type declaration, so adding a collection and forgetting
   * this list fails here — not years later, during someone's restore.
   */
  const partializeAt = store.indexOf('partialize: (state) =>');
  assert.ok(partializeAt > -1, 'partialize must be findable');
  const persisted = store.slice(partializeAt, store.indexOf('}),', partializeAt));
  const persistedKeys = [...persisted.matchAll(/(\w+): state\.(\w+),/g)]
    .filter(([, left, right]) => left === right)
    .map(([, key]) => key);
  assert.ok(persistedKeys.length >= 14, `expected the persisted keys, found ${persistedKeys.length}`);

  const collections = persistedKeys.filter((key) => new RegExp(`\\b${key}: \\w+\\[\\];`).test(types));
  assert.ok(collections.length >= 13, `expected the persisted collections, found ${collections.length}`);

  for (const key of collections) {
    if (key === 'roleWorkspaces') {
      /*
       * The single documented exception, and the reason this list is not
       * "every persisted array". `roleWorkspaces` is seeded from `roleSeed`,
       * so it is non-empty on a fresh install and on every workspace that has
       * ever existed. Counting it would make every state "meaningful",
       * `!hasMeaningfulPersistedWorkspace(nextValue)` could never be true, and
       * BOTH guards would be silently disabled — completing the list the
       * obvious way removes the protection it was meant to complete.
       */
      assert.ok(
        !(MEANINGFUL_WORKSPACE_COLLECTIONS as readonly string[]).includes(key),
        'roleWorkspaces is seeded non-empty and must stay out, or the guards never fire',
      );
      continue;
    }
    assert.ok(
      (MEANINGFUL_WORKSPACE_COLLECTIONS as readonly string[]).includes(key),
      `${key} is persisted but does not count as meaningful — a workspace holding only these reads as empty`,
    );
  }
});

test('a fresh install still reads as empty, so the guard still fires', () => {
  // The over-rejection direction. Every collection added to the list is seeded
  // EMPTY, so widening it must not turn the initial state into something the
  // guards refuse to overwrite — that would block a first session's very first
  // save.
  const freshInstall = JSON.stringify({
    state: Object.fromEntries([
      ...MEANINGFUL_WORKSPACE_COLLECTIONS.map((key) => [key, []]),
      ['roleWorkspaces', [{ role: 'Admin' }]],
      ['workspaceProfile', { ranchName: '', setupCompleteAt: '' }],
    ]),
  });

  assert.equal(hasMeaningfulPersistedWorkspace(freshInstall), false);
  assert.equal(shouldProtectMeaningfulWorkspaceWrite(freshInstall, PARTIAL_WORKSPACE), false);

  // And a workspace holding only one of the newly counted collections is not.
  for (const collection of ['expenseReceipts', 'ranchAssets', 'ownershipRecords', 'salesLeads', 'auditEvents']) {
    const only = JSON.stringify({ state: { [collection]: [{ id: 'x' }] } });
    assert.equal(hasMeaningfulPersistedWorkspace(only), true, `${collection} alone must count`);
  }
});

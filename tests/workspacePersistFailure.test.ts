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

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type LocalFileEntry,
  LocalFileVaultError,
  deleteLocalFile,
  isLocalFileVaultAvailable,
  listLocalFiles,
  localFileVaultBytes,
  orphanedVaultKeys,
  readLocalFile,
  referencedVaultKeys,
  storeLocalFile,
  sweepLocalFileVault,
} from '../src/lib/localFileVault.js';
import { hasStoredFile, storedFileLabel, storedFileLocation } from '../src/lib/storedFiles.js';
import { installFakeIndexedDb } from './helpers/fakeIndexedDb.js';

/** The workspace these tests write as. The vault is origin-wide, so every
 * entry records an owner and the sweep only deletes what it can prove is its
 * own — a browser holding two accounts used to lose one of them. */
const TEST_WORKSPACE = 'ws-test';

/** Write an entry straight into the store, bypassing `storeLocalFile`, so a
 * pre-namespacing record (no `workspaceId`) can be reproduced exactly. */
async function storeLegacyEntry(entry: LocalFileEntry) {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const request = indexedDB.open('xbar-file-vault');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(entry);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

/*
 * The vault is the half of "local-first" that was missing: uploads recorded a
 * file's name, type and size and threw its bytes away, under a log line
 * announcing a local save that never happened.
 *
 * These tests run against a stand-in IndexedDB rather than a real browser. That
 * is a deliberate trade — it cannot prove Safari's quota behaviour — but it does
 * exercise the code paths that matter here: that bytes come back out, that a
 * write failure is raised rather than swallowed, and that orphaned files are
 * reclaimed. The alternative was testing none of it.
 */

test('a stored file comes back out with its bytes intact', async () => {
  const restore = installFakeIndexedDb();
  try {
    const key = await storeLocalFile(
      new Blob(['negative coggins'], { type: 'application/pdf' }),
      'coggins.pdf',
      undefined,
      TEST_WORKSPACE,
    );

    const entry = await readLocalFile(key);
    assert.ok(entry, 'the stored file must be readable back');
    assert.equal(entry.name, 'coggins.pdf');
    assert.equal(entry.type, 'application/pdf');
    // The point of the whole module: the CONTENT, not the metadata about it.
    assert.equal(await entry.blob.text(), 'negative coggins');
  } finally {
    restore();
  }
});

test('two files with the same name are two different files', async () => {
  const restore = installFakeIndexedDb();
  try {
    const first = await storeLocalFile(new Blob(['one']), 'scan.pdf', undefined, TEST_WORKSPACE);
    const second = await storeLocalFile(new Blob(['two']), 'scan.pdf', undefined, TEST_WORKSPACE);

    assert.notEqual(first, second, 'keys must not be derived from the file name');
    assert.equal(await (await readLocalFile(first))?.blob.text(), 'one');
    assert.equal(await (await readLocalFile(second))?.blob.text(), 'two');
  } finally {
    restore();
  }
});

test('a storage failure is raised, never swallowed', async () => {
  const restore = installFakeIndexedDb({ abortWrites: true });
  try {
    await assert.rejects(
      () => storeLocalFile(new Blob(['x']), 'scan.pdf', undefined, TEST_WORKSPACE),
      (error: unknown) => {
        assert.ok(error instanceof LocalFileVaultError);
        // The caller has to be able to tell the rancher something true. A
        // silent failure is how the previous code came to claim a local save
        // it had not performed.
        assert.match((error as Error).message, /room|storage/i);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('a write rolled back at commit is reported as a failure, not as a key', async () => {
  const restore = installFakeIndexedDb({ abortOnCommit: true });
  try {
    // A successful `put` is not a durable write: the browser can still abort
    // the transaction while committing, which is exactly what it does when it
    // runs out of quota. Resolving on the request handed the caller a key for a
    // blob that had been rolled back — the record then persisted that key and
    // reported success, rebuilding the silent file loss one level down.
    await assert.rejects(
      () => storeLocalFile(new Blob(['rolled back']), 'scan.pdf', undefined, TEST_WORKSPACE),
      (error: unknown) => {
        assert.ok(error instanceof LocalFileVaultError);
        assert.match((error as Error).message, /room|storage/i);
        return true;
      },
    );
  } finally {
    restore();
  }

  // And nothing was left behind: the rollback is real, so a caller that ignored
  // the rejection could not find the file either.
  const restoreClean = installFakeIndexedDb();
  try {
    assert.deepEqual(await listLocalFiles(), []);
  } finally {
    restoreClean();
  }
});

test('a browser with no IndexedDB reports that instead of pretending to store', async () => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  assert.equal(isLocalFileVaultAvailable(), false);
  await assert.rejects(
    () => storeLocalFile(new Blob(['x']), 'scan.pdf', undefined, TEST_WORKSPACE),
    LocalFileVaultError,
  );
});

test('a missing file reads as missing rather than as an empty file', async () => {
  const restore = installFakeIndexedDb();
  try {
    assert.equal(await readLocalFile('vault-not-here'), null);
  } finally {
    restore();
  }
});

test('deleting a file removes its bytes and its size from the total', async () => {
  const restore = installFakeIndexedDb();
  try {
    const key = await storeLocalFile(new Blob(['1234567890']), 'scan.pdf', undefined, TEST_WORKSPACE);
    assert.equal(await localFileVaultBytes(), 10);

    await deleteLocalFile(key);
    assert.equal(await readLocalFile(key), null);
    assert.equal(await localFileVaultBytes(), 0);
  } finally {
    restore();
  }
});

test('listing files does not hand back their contents', async () => {
  const restore = installFakeIndexedDb();
  try {
    await storeLocalFile(new Blob(['secret']), 'scan.pdf', undefined, TEST_WORKSPACE);
    const [summary] = await listLocalFiles();

    assert.equal(summary.name, 'scan.pdf');
    // Accounting should not pull every blob in the workspace into memory.
    assert.ok(!('blob' in summary), 'summaries must omit the blob');
  } finally {
    restore();
  }
});

test('orphaned keys are exactly the ones nothing points at', () => {
  const stored = ['vault-a', 'vault-b', 'vault-c'];
  assert.deepEqual(orphanedVaultKeys(stored, ['vault-b']), ['vault-a', 'vault-c']);
  assert.deepEqual(orphanedVaultKeys(stored, stored), []);
  // A reference to something that was never stored is not an error.
  assert.deepEqual(orphanedVaultKeys(stored, ['vault-z']), stored);
});

test('references are collected across every record type that can carry a file', () => {
  const keys = referencedVaultKeys(
    [{ localFileKey: 'vault-doc' }, {}],
    [{ localFileKey: 'vault-receipt' }],
    [{ localFileKey: 'vault-doc' }, { localFileKey: 'vault-packet' }],
  );

  assert.deepEqual(new Set(keys), new Set(['vault-doc', 'vault-receipt', 'vault-packet']));
});

test('the sweep reclaims orphans and keeps everything still referenced', async () => {
  const restore = installFakeIndexedDb();
  try {
    const kept = await storeLocalFile(new Blob(['keep']), 'keep.pdf', undefined, TEST_WORKSPACE);
    const dropped = await storeLocalFile(new Blob(['drop']), 'drop.pdf', undefined, TEST_WORKSPACE);

    const removed = await sweepLocalFileVault([kept], TEST_WORKSPACE);

    assert.equal(removed, 1);
    assert.ok(await readLocalFile(kept), 'a referenced file must survive the sweep');
    assert.equal(await readLocalFile(dropped), null, 'an unreferenced file must be reclaimed');
  } finally {
    restore();
  }
});

test('the sweep never throws, so a broken vault cannot stop the app starting', async () => {
  const restore = installFakeIndexedDb({ abortWrites: true });
  try {
    assert.equal(await sweepLocalFileVault([], TEST_WORKSPACE), 0);
  } finally {
    restore();
  }

  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  assert.equal(await sweepLocalFileVault([], TEST_WORKSPACE), 0);
});

test('where a file is, is answered the same way the resolver resolves it', () => {
  assert.equal(storedFileLocation({ fileUrl: 'https://example.test/a.pdf', localFileKey: 'vault-a' }), 'link');
  assert.equal(storedFileLocation({ localFileKey: 'vault-a', storagePath: 'docs/a.pdf' }), 'device');
  assert.equal(storedFileLocation({ storagePath: 'docs/a.pdf' }), 'cloud');
  assert.equal(storedFileLocation({}), 'none');
  // Whitespace is not a link.
  assert.equal(storedFileLocation({ fileUrl: '   ' }), 'none');
});

test('a locally held file counts as a file the UI can offer to open', () => {
  assert.equal(hasStoredFile({ localFileKey: 'vault-a' }), true);
  assert.equal(hasStoredFile({}), false);
  assert.equal(storedFileLabel({ localFileKey: 'vault-a' }), 'On this device');
});

test('one workspace cannot sweep away another workspace files', async () => {
  const restore = installFakeIndexedDb();
  try {
    /*
     * The vault is one IndexedDB database per browser ORIGIN. A workspace is
     * not. The same browser can hold two cloud accounts, or a cloud workspace
     * and a local-only one — and the sweep compared the whole origin-wide vault
     * against whichever workspace happened to be hydrated.
     *
     * So the first time workspace B loaded, every device-only document,
     * receipt and packet belonging to workspace A was deleted as an apparent
     * orphan. Permanently. Switching back to A then restored records whose
     * localFileKey pointed at nothing.
     */
    const mine = await storeLocalFile(new Blob(['my coggins']), 'mine.pdf', undefined, 'ws-a');
    const theirs = await storeLocalFile(new Blob(['their coggins']), 'theirs.pdf', undefined, 'ws-b');

    // Workspace A rehydrates and references nothing at all — a genuinely empty
    // workspace, which is a real state and does sweep.
    const removed = await sweepLocalFileVault([], 'ws-a');

    assert.equal(removed, 1, 'only this workspace unreferenced file is an orphan');
    assert.equal(await readLocalFile(mine), null, 'its own orphan is still collected');
    assert.notEqual(await readLocalFile(theirs), null, 'the other workspace file must survive');
  } finally {
    restore();
  }
});

test('a file with no recorded owner is never swept', async () => {
  const restore = installFakeIndexedDb();
  try {
    // Written before ownership was recorded. Unowned is indistinguishable from
    // someone else's, and leaking a little storage is a far smaller harm than
    // deleting a rancher's only copy of a document.
    const legacy = await storeLocalFile(new Blob(['old']), 'legacy.pdf', undefined, 'ws-a');
    const entry = await readLocalFile(legacy);
    assert.ok(entry);
    await storeLegacyEntry({ ...entry, workspaceId: undefined });

    assert.equal(await sweepLocalFileVault([], 'ws-a'), 0);
    assert.notEqual(await readLocalFile(legacy), null, 'an unowned file must not be deleted on a guess');
  } finally {
    restore();
  }
});

test('an unowned file this workspace uses is adopted, so it can be cleaned up later', async () => {
  const restore = installFakeIndexedDb();
  try {
    const legacy = await storeLocalFile(new Blob(['old']), 'legacy.pdf', undefined, 'ws-a');
    const entry = await readLocalFile(legacy);
    assert.ok(entry);
    await storeLegacyEntry({ ...entry, workspaceId: undefined });

    // Referenced by this workspace, so it is provably ours. Claiming it turns a
    // file that could never be collected into one that can.
    await sweepLocalFileVault([legacy], 'ws-a');
    const adopted = await readLocalFile(legacy);
    assert.equal(adopted?.workspaceId, 'ws-a');

    assert.equal(await sweepLocalFileVault([], 'ws-a'), 1, 'and now it can be collected');
  } finally {
    restore();
  }
});

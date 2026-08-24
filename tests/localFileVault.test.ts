import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

type StoredRecord = { key: string; [field: string]: unknown };

interface FakeOptions {
  /** Abort the transaction outright, before the request itself succeeds. */
  abortWrites?: boolean;
  /**
   * Let the request succeed and then abort while committing.
   *
   * This is how a browser out of storage quota actually behaves, and it is the
   * case that made resolving on `request.onsuccess` unsafe: the write reports
   * success and is then rolled back.
   */
  abortOnCommit?: boolean;
}

/**
 * A minimal IndexedDB.
 *
 * Two behaviours of the real API are modelled deliberately, because the vault
 * depends on both. Callbacks fire on a macrotask, never synchronously — the
 * vault assigns `request.onsuccess` on the line AFTER it issues the request, so
 * a synchronous stand-in would silently test nothing. And writes are buffered
 * until the transaction commits, so an abort rolls them back rather than
 * leaving them applied.
 */
function installFakeIndexedDb(options: FakeOptions = {}) {
  const stores = new Map<string, Map<string, StoredRecord>>();
  const later = (run: () => void) => setTimeout(run, 0);

  const makeStore = (name: string) => {
    const data = stores.get(name) ?? new Map<string, StoredRecord>();
    stores.set(name, data);
    return data;
  };

  const factory = {
    // The name and version the vault passes are ignored: this stand-in holds
    // one database, and versioning is the browser's problem, not the test's.
    open() {
      const request: Record<string, unknown> = { result: null, error: null };
      later(() => {
        const database = {
          objectStoreNames: { contains: (name: string) => stores.has(name) },
          createObjectStore: (name: string) => makeStore(name),
          close: () => {},
          transaction(storeName: string) {
            const data = makeStore(storeName);
            const transaction: Record<string, unknown> = { error: null };
            // Writes wait here until the transaction commits, so an abort
            // leaves the store exactly as it was.
            const buffered: (() => void)[] = [];
            let settled = false;

            const commit = () => {
              if (settled) return;
              settled = true;
              if (options.abortOnCommit) {
                (transaction.onabort as (() => void) | undefined)?.();
                return;
              }
              for (const write of buffered) write();
              (transaction.oncomplete as (() => void) | undefined)?.();
            };

            const issue = <T>(compute: () => T, write?: () => void) => {
              const childRequest: Record<string, unknown> = { result: undefined, error: null };
              later(() => {
                if (options.abortWrites) {
                  settled = true;
                  (transaction.onabort as (() => void) | undefined)?.();
                  return;
                }
                childRequest.result = compute();
                if (write) buffered.push(write);
                (childRequest.onsuccess as (() => void) | undefined)?.();
                later(commit);
              });
              return childRequest;
            };

            transaction.objectStore = () => ({
              put: (value: StoredRecord) =>
                issue(
                  () => undefined,
                  () => data.set(value.key, value),
                ),
              get: (key: string) => issue(() => data.get(key)),
              delete: (key: string) =>
                issue(
                  () => undefined,
                  () => data.delete(key),
                ),
              getAll: () => issue(() => [...data.values()]),
            });
            return transaction;
          },
        };
        request.result = database;
        (request.onupgradeneeded as (() => void) | undefined)?.();
        (request.onsuccess as (() => void) | undefined)?.();
      });
      return request;
    },
  };

  (globalThis as { indexedDB?: unknown }).indexedDB = factory;
  return () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  };
}

test('a stored file comes back out with its bytes intact', async () => {
  const restore = installFakeIndexedDb();
  try {
    const key = await storeLocalFile(new Blob(['negative coggins'], { type: 'application/pdf' }), 'coggins.pdf');

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
    const first = await storeLocalFile(new Blob(['one']), 'scan.pdf');
    const second = await storeLocalFile(new Blob(['two']), 'scan.pdf');

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
      () => storeLocalFile(new Blob(['x']), 'scan.pdf'),
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
      () => storeLocalFile(new Blob(['rolled back']), 'scan.pdf'),
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
  await assert.rejects(() => storeLocalFile(new Blob(['x']), 'scan.pdf'), LocalFileVaultError);
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
    const key = await storeLocalFile(new Blob(['1234567890']), 'scan.pdf');
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
    await storeLocalFile(new Blob(['secret']), 'scan.pdf');
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
    const kept = await storeLocalFile(new Blob(['keep']), 'keep.pdf');
    const dropped = await storeLocalFile(new Blob(['drop']), 'drop.pdf');

    const removed = await sweepLocalFileVault([kept]);

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
    assert.equal(await sweepLocalFileVault([]), 0);
  } finally {
    restore();
  }

  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  assert.equal(await sweepLocalFileVault([]), 0);
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

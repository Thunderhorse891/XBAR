/*
 * A minimal IndexedDB, shared by every suite that touches the on-device vault.
 *
 * Lives here rather than in one test file because two suites need it and a
 * second copy would drift — and the fidelity of this double is load-bearing: it
 * is what decides whether a storage bug is expressible in a test at all.
 */
type StoredRecord = { key: string; [field: string]: unknown };

/*
 * A store holds either in-line records or out-of-line values.
 *
 * `put(value)` uses a key that lives on the record — the file vault's shape —
 * while `put(value, key)` passes the key separately, which is what the
 * workspace persister does with a plain JSON string. Modelling only the first
 * meant every workspace write landed under `undefined` and read back as
 * absent, so no test in this repo could observe a write REPLACING stored data.
 * That is the whole shape of a data-loss bug, and it was inexpressible.
 */
type StoredEntry = StoredRecord | string;

export interface FakeOptions {
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
  /**
   * Make deletion fail, the way a browser refusing it does.
   *
   * Covers both shapes: `deleteDatabase`, and deleting an individual entry —
   * which is what the vault does now that a purge is scoped to one workspace
   * rather than dropping the origin-wide database.
   */
  refuseDelete?: boolean;
  /**
   * Make reads fail, the way a browser that cannot open its store does.
   *
   * A predicate rather than a flag because the interesting case is storage
   * that fails during hydration and then RECOVERS: a read failure is only
   * dangerous once the workspace it could not see is readable again.
   */
  failReads?: () => boolean;
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
export function installFakeIndexedDb(options: FakeOptions = {}) {
  const stores = new Map<string, Map<string, StoredEntry>>();
  const later = (run: () => void) => setTimeout(run, 0);

  const makeStore = (name: string) => {
    const data = stores.get(name) ?? new Map<string, StoredEntry>();
    stores.set(name, data);
    return data;
  };

  const factory = {
    // `clearLocalFileVault` deletes the whole database rather than each entry,
    // so the double has to model that or the purge cannot be tested.
    deleteDatabase() {
      const request: Record<string, unknown> = {};
      later(() => {
        if (options.refuseDelete) {
          (request.onerror as (() => void) | undefined)?.();
          return;
        }
        stores.clear();
        (request.onsuccess as (() => void) | undefined)?.();
      });
      return request;
    },
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
              // The second argument is IndexedDB's out-of-line key. Ignoring it
              // is what made workspace writes vanish under `undefined`.
              put: (value: StoredEntry, key?: string) =>
                issue(
                  () => undefined,
                  () => data.set(key ?? (value as StoredRecord).key, value),
                ),
              get: (key: string) => {
                if (options.failReads?.()) {
                  const request: Record<string, unknown> = {
                    result: undefined,
                    error: new Error('IndexedDB read failed.'),
                  };
                  later(() => {
                    settled = true;
                    (request.onerror as (() => void) | undefined)?.();
                  });
                  return request;
                }
                return issue(() => data.get(key));
              },
              delete: (key: string) => {
                if (options.refuseDelete) {
                  const request: Record<string, unknown> = {};
                  later(() => {
                    (transaction.onabort as (() => void) | undefined)?.();
                  });
                  return request;
                }
                return issue(
                  () => undefined,
                  () => data.delete(key),
                );
              },
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

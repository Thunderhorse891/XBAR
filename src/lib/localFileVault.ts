/*
 * Where a locally-held file actually lives.
 *
 * XBAR is sold as working without a cloud account, and the upload paths said so
 * in their logs — `console.error('Cloud upload failed; storing file locally
 * instead')` — but nothing stored anything. The record kept the file's name,
 * type and size; the bytes were dropped on the floor. A rancher with no
 * Supabase project uploaded a Coggins, saw it listed, clicked it, and was told
 * the document had no file attached.
 *
 * This is that missing half: a blob store in IndexedDB, keyed by an opaque id
 * that goes on the record. It is deliberately a SEPARATE database from the one
 * zustand persists workspace state into — file bytes are orders of magnitude
 * larger than the state document, and a quota failure while writing a 12MB scan
 * must not be able to take the workspace's own persistence down with it.
 *
 * Failures are reported, never swallowed. A silent storage failure is the worst
 * outcome available here: the app looks like it saved the file, and the rancher
 * finds out it did not on the day they need it.
 */

const DATABASE_NAME = 'xbar-file-vault';
const DATABASE_VERSION = 1;
const STORE_NAME = 'files';

/** What the vault holds for one file. The blob is the point; the rest is for accounting. */
export interface LocalFileEntry {
  key: string;
  name: string;
  type: string;
  size: number;
  storedAt: string;
  blob: Blob;
}

/** An entry's metadata, without pulling its bytes into memory. */
export type LocalFileSummary = Omit<LocalFileEntry, 'blob'>;

export class LocalFileVaultError extends Error {
  /** The DOMException IndexedDB failed with, when there was one. */
  readonly cause?: unknown;

  // Assigned rather than passed to `super`: the `cause` constructor option is
  // ES2022 and this project's lib target does not declare it.
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'LocalFileVaultError';
    this.cause = options?.cause;
  }
}

/**
 * Read `indexedDB` off the global at call time rather than at import time.
 *
 * Call time is what makes this testable without a browser or a fake-IndexedDB
 * dependency: a test installs a stand-in on `globalThis` and the module picks
 * it up. Reading it at import time would bind whatever existed when the module
 * first loaded, which in Node is nothing.
 */
function getIndexedDb(): IDBFactory | null {
  const candidate = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  return candidate ?? null;
}

export function isLocalFileVaultAvailable(): boolean {
  return getIndexedDb() !== null;
}

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = getIndexedDb();
    if (!factory) {
      reject(new LocalFileVaultError('This browser cannot store files locally (IndexedDB is unavailable).'));
      return;
    }

    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new LocalFileVaultError('Unable to open local file storage.', { cause: request.error }));
    // A version change blocked by another tab hangs forever otherwise.
    request.onblocked = () =>
      reject(new LocalFileVaultError('Local file storage is in use by another XBAR tab. Close it and try again.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openVault();

  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = action(store);

      /*
       * The result is held, not returned, until the transaction COMMITS.
       *
       * A successful `put` is not a durable write. IndexedDB can still abort
       * the transaction while committing — a browser hitting its storage quota
       * does exactly that — and everything in it is rolled back. Resolving on
       * `request.onsuccess` handed back a key for a blob that no longer
       * existed, and the caller then persisted that key and reported success:
       * the silent file loss this whole module exists to stop, rebuilt one
       * level down.
       */
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () =>
        reject(new LocalFileVaultError('Local file storage rejected the request.', { cause: request.error }));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () =>
        reject(new LocalFileVaultError('Local file storage rejected the request.', { cause: transaction.error }));
      transaction.onabort = () =>
        reject(
          new LocalFileVaultError('Local file storage ran out of room. Free up browser storage and try again.', {
            cause: transaction.error,
          }),
        );
    });
  } finally {
    // Safe here only because the promise above now settles on the
    // transaction's own completion rather than on the request's.
    database.close();
  }
}

/**
 * Opaque, unguessable, and prefixed so a key is recognizable in a persisted
 * record. Not derived from the file name: two receipts called `scan.pdf` are
 * two different files, and a content hash would collide two identical scans
 * that belong to different horses.
 */
function createVaultKey(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.randomUUID) return `vault-${cryptoApi.randomUUID()}`;
  return `vault-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Put a file in the vault and return its key.
 *
 * Throws rather than returning null on failure. Every caller has to decide what
 * to tell the rancher, and a null that reads like "no file was offered" is
 * exactly how the previous code came to claim a local save it never performed.
 */
export async function storeLocalFile(file: Blob, name: string, type?: string): Promise<string> {
  const entry: LocalFileEntry = {
    key: createVaultKey(),
    name,
    type: type ?? file.type ?? '',
    size: file.size,
    storedAt: new Date().toISOString(),
    blob: file,
  };

  await withStore('readwrite', (store) => store.put(entry));
  return entry.key;
}

export async function readLocalFile(key: string): Promise<LocalFileEntry | null> {
  const entry = await withStore<LocalFileEntry | undefined>('readonly', (store) => store.get(key));
  return entry ?? null;
}

export async function deleteLocalFile(key: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(key));
}

export async function listLocalFiles(): Promise<LocalFileSummary[]> {
  const entries = await withStore<LocalFileEntry[]>('readonly', (store) => store.getAll());
  return entries.map(({ blob: _blob, ...summary }) => summary);
}

/** Total bytes the vault is holding, for honest "files stored on this device" reporting. */
export async function localFileVaultBytes(): Promise<number> {
  const entries = await listLocalFiles();
  return entries.reduce((total, entry) => total + entry.size, 0);
}

/**
 * Every vault key the workspace still points at.
 *
 * Variadic over record groups rather than typed against the store, so it stays
 * usable from a test without constructing a workspace and cannot drift when a
 * new record type starts carrying files.
 */
export function referencedVaultKeys(...groups: { localFileKey?: string }[][]): string[] {
  const keys = new Set<string>();
  for (const group of groups) {
    for (const record of group) {
      if (record.localFileKey) keys.add(record.localFileKey);
    }
  }
  return [...keys];
}

/**
 * Which stored keys no longer belong to any record.
 *
 * Kept as a pure function so the sweep below can be tested without a database,
 * and so deletion is decided in one place. Records are archived rather than
 * deleted in most of this app, and a horse deletion cascades to its receipts,
 * so chasing every removal path individually is how an orphan gets missed —
 * reconciling against the live set catches all of them, including paths that do
 * not exist yet.
 */
export function orphanedVaultKeys(storedKeys: string[], referencedKeys: Iterable<string>): string[] {
  const referenced = new Set(referencedKeys);
  return storedKeys.filter((key) => !referenced.has(key));
}

/**
 * Delete everything the workspace no longer points at.
 *
 * Returns the number of entries removed. Never throws: this runs on rehydration
 * as housekeeping, and failing to reclaim space is not a reason to stop the app
 * from starting.
 */
export async function sweepLocalFileVault(referencedKeys: Iterable<string>): Promise<number> {
  if (!isLocalFileVaultAvailable()) return 0;

  try {
    const stored = await listLocalFiles();
    const orphans = orphanedVaultKeys(
      stored.map((entry) => entry.key),
      referencedKeys,
    );
    for (const key of orphans) {
      await deleteLocalFile(key);
    }
    return orphans.length;
  } catch {
    return 0;
  }
}

/*
 * Handing a stored file to the browser.
 *
 * An object URL is a live reference into the page's memory, so every one handed
 * out has to be given back. Two things make that reliable here: the caller gets
 * an explicit `release`, and every URL still outstanding is revoked when the
 * page goes away — a rancher who opens six scans and closes the tab should not
 * be holding six blobs until the process exits.
 */
const outstandingUrls = new Set<string>();
let pageUnloadHooked = false;

function hookPageUnload() {
  if (pageUnloadHooked || typeof window === 'undefined') return;
  pageUnloadHooked = true;
  // `pagehide` rather than `unload`: `unload` does not fire on iOS Safari or in
  // any browser restoring from the back/forward cache, which is most of them.
  window.addEventListener('pagehide', () => {
    for (const url of outstandingUrls) URL.revokeObjectURL(url);
    outstandingUrls.clear();
  });
}

export interface LocalFileHandle {
  url: string;
  name: string;
  type: string;
  size: number;
  release: () => void;
}

/**
 * Resolve a vault key to something the browser can open.
 *
 * Returns null when the key is not in the vault — the file was stored on a
 * different device, or browser storage was cleared. That is a real state a
 * local-first workspace can be in, and the caller has to say so rather than
 * showing a broken link.
 */
export async function openLocalFile(key: string): Promise<LocalFileHandle | null> {
  const entry = await readLocalFile(key);
  if (!entry) return null;

  hookPageUnload();
  const url = URL.createObjectURL(entry.blob);
  outstandingUrls.add(url);

  return {
    url,
    name: entry.name,
    type: entry.type,
    size: entry.size,
    release: () => {
      if (!outstandingUrls.delete(url)) return;
      URL.revokeObjectURL(url);
    },
  };
}

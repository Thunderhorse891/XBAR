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

/*
 * Getting bytes in and out of the vault as text.
 *
 * Two callers need this — a sale packet embeds its documents as `data:` URLs,
 * and a workspace backup carries them inside a JSON file — so the conversion
 * lives here rather than in either of them. Both are round trips of the same
 * bytes, and having them agree matters: a backup written by one encoder and
 * read by another that disagrees about padding loses files silently.
 */

/**
 * How many bytes are turned into characters per `String.fromCharCode` call.
 *
 * Spreading a whole file into one call overflows the argument limit — a 5MB
 * scan is 5 million arguments — and it fails as a RangeError deep inside the
 * conversion, which reads like a corrupt file rather than a size problem.
 */
const BASE64_CHUNK_BYTES = 0x8000;

/**
 * Base64 a blob.
 *
 * Built on `arrayBuffer` and `btoa` rather than `FileReader`, which is a
 * browser-only global — the conversion is the part most worth testing, and a
 * FileReader implementation could only ever be tested in a browser.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES));
  }

  return btoa(binary);
}

/** The inverse. Throws on input that is not base64, which a hand-edited backup can be. */
export function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  // Backed by a plain ArrayBuffer, not the SharedArrayBuffer the default type
  // allows: a Blob part has to be transferable memory.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/*
 * Carrying the vault between devices.
 *
 * `exportWorkspaceBackup` writes the workspace as JSON, and the records in it
 * keep only an opaque `localFileKey`. Restored on a second device — or on the
 * same one after browser storage was cleared — every document and receipt was
 * listed as stored on-device and could not be opened. The backup a rancher runs
 * precisely so they do not lose their proof was quietly leaving all of it
 * behind.
 */

/** One vault entry in a form that survives JSON. */
export interface PortableLocalFile {
  key: string;
  name: string;
  type: string;
  size: number;
  storedAt: string;
  /** The file's bytes, base64. */
  data: string;
}

/** A file the backup could not carry, and why — named rather than dropped. */
export interface UnbackedUpFile {
  name: string;
  reason: string;
}

/**
 * Total source bytes a backup will carry.
 *
 * Base64 adds about a third, and the backup is built as one JSON string in
 * memory before it is downloaded, so this is a ceiling on what the browser can
 * actually serialize rather than a policy preference. A backup that cannot be
 * written at all protects nothing; one that names the files it left out can be
 * acted on.
 */
export const MAX_BACKUP_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Read the referenced files out of the vault, largest-last.
 *
 * Ordered smallest first so a budget that cannot fit everything still carries
 * the most files it can, rather than being consumed by one video.
 */
export async function exportLocalFiles(
  keys: Iterable<string>,
  maxBytes = MAX_BACKUP_FILE_BYTES,
): Promise<{ files: PortableLocalFile[]; skipped: UnbackedUpFile[] }> {
  const files: PortableLocalFile[] = [];
  const skipped: UnbackedUpFile[] = [];

  if (!isLocalFileVaultAvailable()) {
    return { files, skipped };
  }

  const wanted = new Set(keys);
  let stored: LocalFileSummary[];
  try {
    stored = (await listLocalFiles()).filter((entry) => wanted.has(entry.key));
  } catch (error) {
    console.error("Reading this device's files for the backup failed.", error);
    return { files, skipped };
  }

  /*
   * A record can name a file this device does not have — most often because the
   * workspace came from a cloud snapshot written on another machine.
   *
   * Filtering the vault by the wanted keys silently drops those, so the backup
   * reported plain success (or even "no files were stored on this device")
   * while carrying records whose proof was somewhere else entirely. Someone
   * could then clear their storage believing the backup was complete. Named,
   * not dropped.
   */
  const found = new Set(stored.map((entry) => entry.key));
  for (const key of wanted) {
    if (!found.has(key)) {
      skipped.push({ name: key, reason: 'the file is not stored on this device' });
    }
  }

  let usedBytes = 0;
  for (const summary of [...stored].sort((a, b) => a.size - b.size)) {
    if (usedBytes + summary.size > maxBytes) {
      skipped.push({ name: summary.name, reason: 'too large to fit in the backup file' });
      continue;
    }

    try {
      const entry = await readLocalFile(summary.key);
      if (!entry) {
        skipped.push({ name: summary.name, reason: 'the stored file is no longer on this device' });
        continue;
      }
      files.push({
        key: entry.key,
        name: entry.name,
        type: entry.type,
        size: entry.size,
        storedAt: entry.storedAt,
        data: await blobToBase64(entry.blob),
      });
      usedBytes += entry.size;
    } catch (error) {
      console.error('Reading a file for the backup failed.', error);
      skipped.push({ name: summary.name, reason: 'the stored file could not be read' });
    }
  }

  return { files, skipped };
}

/**
 * Put backed-up files back, under the keys the records already point at.
 *
 * Deliberately not `storeLocalFile`, which mints a new key: the restored
 * records carry the original `localFileKey`, so a new one would leave every
 * document pointing at nothing. Returns how many were restored, so the caller
 * can tell the rancher what actually came back.
 */
export async function importLocalFiles(
  files: PortableLocalFile[],
): Promise<{ restored: number; failed: UnbackedUpFile[] }> {
  const failed: UnbackedUpFile[] = [];

  if (!isLocalFileVaultAvailable()) {
    return {
      restored: 0,
      failed: files.map((file) => ({
        name: file?.name || file?.key || 'a file',
        reason: 'this browser cannot store files on this device',
      })),
    };
  }

  let restored = 0;
  for (const file of files) {
    if (!file?.key || typeof file.data !== 'string') {
      failed.push({ name: file?.name || 'an unnamed entry', reason: 'the backup entry is malformed' });
      continue;
    }
    try {
      const bytes = base64ToBytes(file.data);
      const entry: LocalFileEntry = {
        key: file.key,
        name: file.name || 'restored-file',
        type: file.type || '',
        size: bytes.byteLength,
        storedAt: file.storedAt || new Date().toISOString(),
        blob: new Blob([bytes], { type: file.type || 'application/octet-stream' }),
      };
      await withStore('readwrite', (store) => store.put(entry));
      restored += 1;
    } catch (error) {
      // One unreadable entry must not abandon the rest of the restore — but it
      // must not vanish either. A record whose blob failed to land keeps a
      // localFileKey that resolves to nothing, and only this list can tell the
      // rancher which of their proof did not come back.
      console.error('Restoring a backed-up file failed.', error);
      failed.push({ name: file.name || file.key, reason: 'the file could not be written to this device' });
    }
  }

  return { restored, failed };
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

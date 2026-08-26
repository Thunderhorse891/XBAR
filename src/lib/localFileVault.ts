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
  /**
   * Which workspace put this file here.
   *
   * The vault is one database per browser ORIGIN, but a workspace is not: the
   * same browser can hold two cloud accounts, or a cloud workspace and a
   * local-only one. Without an owner recorded, the orphan sweep compared an
   * origin-wide vault against whichever workspace happened to be hydrated and
   * permanently deleted the other one's documents, receipts and packets — then,
   * switching back, restored records whose `localFileKey` pointed at nothing.
   *
   * Absent on entries written before this existed. Those are never swept: an
   * unowned file cannot be proven an orphan rather than someone else's, and
   * leaking storage is a smaller harm than deleting a rancher's only copy of a
   * Coggins.
   */
  workspaceId?: string;
  /**
   * True when XBAR produced this file, false when a person supplied it.
   *
   * Provenance, not file type, is what decides whether something may render as
   * a document under this origin. A sale packet is `text/html` that this app
   * wrote, with an inline verifier whose hash the CSP allows on purpose; an
   * uploaded `.html` or `.svg` is someone else's script. Judging both by their
   * MIME type meant either packets stopped opening — silently disabling the
   * verifier the CSP work exists to run — or uploads got to execute.
   */
  generated?: boolean;
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
/**
 * Put a file in the vault, tagged with the workspace it belongs to.
 *
 * `workspaceId` is required rather than defaulted, and passed rather than read
 * from a module-level "current workspace": the failure mode of getting it wrong
 * is deleting someone else's files, so every caller states which workspace it is
 * writing for. `vaultOwnerId()` is the one place that answers that question.
 */
export async function storeLocalFile(
  file: Blob,
  name: string,
  type: string | undefined,
  workspaceId: string,
  options?: { generated?: boolean },
): Promise<string> {
  const entry: LocalFileEntry = {
    key: createVaultKey(),
    name,
    type: type ?? file.type ?? '',
    size: file.size,
    storedAt: new Date().toISOString(),
    workspaceId,
    generated: options?.generated ?? false,
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

/*
 * Note what is NOT in `PortableLocalFile`: `generated`, and `workspaceId`.
 *
 * Both are deliberate. A backup file is arbitrary attacker-supplied JSON — a
 * `generated: true` in it would let an uploaded `.html` claim XBAR wrote it and
 * earn script execution under this origin on restore, which is precisely the
 * hole the provenance flag exists to close. And an archived `workspaceId` would
 * let a backup restore files tagged to a workspace that is not the one
 * importing them.
 *
 * So both are decided by the importer from data it trusts: the workspace doing
 * the restore, and that workspace's own validated sale-packet records.
 */

/** A file the backup could not carry, and why — named rather than dropped. */
export interface UnbackedUpFile {
  /*
   * The vault key, which is what reconciliation matches on.
   *
   * `name` alone was not enough and failed precisely where this manifest earns
   * its keep. A record points at a KEY, so the restore looks omissions up by
   * key — but the size and read-failure cases recorded the display filename,
   * so the lookup missed and the warning showed a bare `vault-...` with no
   * reason. The two cases the manifest exists to explain were the two it could
   * not.
   */
  key: string;
  /** What to call it to a person. Falls back to the key when nothing better is known. */
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
/**
 * Whether a workspace may read the bytes behind a vault entry.
 *
 * The vault is one IndexedDB database per browser ORIGIN, so possessing a key
 * has never meant owning the file. A restored record can carry another
 * workspace's key — a file omitted from an archive is never remapped by
 * `importLocalFiles` — and every path that resolves a key to bytes is a place
 * that reference turns into a disclosure.
 *
 * One predicate rather than the comparison written out at each site: this rule
 * has now been missed at three separate read paths, and each miss looked
 * exactly like the last.
 *
 * Untagged entries are readable. They predate ownership being recorded, so
 * unowned is indistinguishable from mine, and refusing them locks people out of
 * their own files. This is the mirror of the sweep's rule: the sweep deletes
 * only what it can prove is its own, this refuses only what it can prove is
 * someone else's.
 */
export function mayReadVaultEntry(entry: { workspaceId?: string }, workspaceId: string): boolean {
  return entry.workspaceId === undefined || entry.workspaceId === workspaceId;
}

export async function exportLocalFiles(
  keys: Iterable<string>,
  workspaceId: string,
  maxBytes = MAX_BACKUP_FILE_BYTES,
): Promise<{ files: PortableLocalFile[]; skipped: UnbackedUpFile[] }> {
  const files: PortableLocalFile[] = [];
  const skipped: UnbackedUpFile[] = [];
  const wanted = new Set(keys);

  /*
   * When the vault cannot be read at all, every requested file is missing from
   * the backup — say so for each of them.
   *
   * Returning empty `files` AND empty `skipped` reported the same thing as a
   * workspace that genuinely has no local files, so Settings downloaded a
   * metadata-only backup and called it a success. That is the missing-key
   * defect again, one branch up, on the path where MORE is lost rather than
   * less: not one file omitted, but all of them.
   */
  const allUnreadable = (reason: string) => ({
    files,
    skipped: [...wanted].map((key) => ({ key, name: key, reason })),
  });

  if (!isLocalFileVaultAvailable()) {
    return allUnreadable('this browser cannot store or read files on this device');
  }

  let stored: LocalFileSummary[];
  try {
    /*
     * By key AND by owner. Filtering on the key alone put another workspace's
     * document bytes into this workspace's backup file — the same dangling
     * reference the restore note and `openLocalFile` already refuse, reaching
     * the one path that copies the bytes somewhere they can be opened freely.
     */
    stored = (await listLocalFiles()).filter((entry) => wanted.has(entry.key) && mayReadVaultEntry(entry, workspaceId));
  } catch (error) {
    console.error("Reading this device's files for the backup failed.", error);
    return allUnreadable("this device's file storage could not be read");
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
      skipped.push({ key, name: key, reason: 'the file is not stored on this device' });
    }
  }

  let usedBytes = 0;
  for (const summary of [...stored].sort((a, b) => a.size - b.size)) {
    if (usedBytes + summary.size > maxBytes) {
      skipped.push({ key: summary.key, name: summary.name, reason: 'too large to fit in the backup file' });
      continue;
    }

    try {
      const entry = await readLocalFile(summary.key);
      if (!entry) {
        skipped.push({ key: summary.key, name: summary.name, reason: 'the stored file is no longer on this device' });
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
      skipped.push({ key: summary.key, name: summary.name, reason: 'the stored file could not be read' });
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
  context: { workspaceId: string },
): Promise<{ restored: number; failed: UnbackedUpFile[]; remapped: Record<string, string> }> {
  /*
   * Keys are preserved only when they are free, or already ours.
   *
   * The vault is origin-wide and the keys in a backup were minted in whatever
   * workspace exported it. Restoring under the original key therefore
   * OVERWRITES a colliding entry belonging to another account in this browser
   * and retags it to the importer — after which a sweep or account deletion of
   * the importer permanently removes the only local copy the other account
   * still referenced. Someone else's document, destroyed by your restore.
   *
   * A colliding key from another workspace is minted fresh instead, and the
   * mapping is returned so the caller can rewrite the restored records to point
   * at the new key. Without that rewrite the file would land and the record
   * would still point at the old one.
   */
  const remapped: Record<string, string> = {};
  const failed: UnbackedUpFile[] = [];

  if (!isLocalFileVaultAvailable()) {
    return {
      restored: 0,
      failed: files.map((file) => ({
        key: file?.key || '',
        name: file?.name || file?.key || 'a file',
        reason: 'this browser cannot store files on this device',
      })),
      remapped: {},
    };
  }

  let restored = 0;
  for (const file of files) {
    if (!file?.key || typeof file.data !== 'string') {
      // A malformed entry has no usable key by definition — that is what makes
      // it malformed — so there is nothing for the restore to reconcile against.
      failed.push({ key: '', name: file?.name || 'an unnamed entry', reason: 'the backup entry is malformed' });
      continue;
    }
    try {
      const existing = await readLocalFile(file.key);
      let key = file.key;
      if (existing && existing.workspaceId !== context.workspaceId) {
        key = createVaultKey();
        remapped[file.key] = key;
      }

      const bytes = base64ToBytes(file.data);
      const entry: LocalFileEntry = {
        key,
        name: file.name || 'restored-file',
        type: file.type || '',
        size: bytes.byteLength,
        storedAt: file.storedAt || new Date().toISOString(),
        // Tagged to the workspace doing the restore. Without this a restored
        // file has no owner, so it can never be swept and never purged when the
        // account is deleted — it would simply accumulate forever.
        workspaceId: context.workspaceId,
        /*
         * Never. A restored file is download-only, whatever the archive says
         * about it and whatever the archive's own records claim it is.
         *
         * Deriving this from the backup's `salePacketBuilds` looked safe
         * because those records are normalized first — but normalization only
         * requires a non-empty id, so a crafted backup could point a "packet"
         * record at an arbitrary HTML entry and have it stored as generated,
         * bypassing the inert-MIME allowlist and executing in this origin.
         * Every signal available here comes from the archive, so none of them
         * can grant script execution.
         *
         * The packet is not lost: opened from disk it is not same-origin with
         * XBAR, and its verifier runs there with no CSP to satisfy.
         */
        generated: false,
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
      failed.push({
        key: file.key,
        name: file.name || file.key,
        reason: 'the file could not be written to this device',
      });
    }
  }

  return { restored, failed, remapped };
}

/**
 * Every vault key the workspace still points at.
 *
 * Variadic over record groups rather than typed against the store, so it stays
 * usable from a test without constructing a workspace and cannot drift when a
 * new record type starts carrying files.
 */
/**
 * Hand this workspace's own files over when it is promoted to a cloud account.
 *
 * A signed-out rancher's files are owned by `'local'`. Signing in gives the
 * browser a new vault owner, and the ownership checks then refuse every one of
 * those entries — the records still name them, and nothing can open, export or
 * attach them. The rancher signed in and their documents vanished.
 *
 * That is the ONE case where re-tagging is provably safe, and it is worth being
 * exact about why, because the ambiguous version of this deletes data. Two
 * conditions together:
 *
 *   - the entry is currently `'local'` or untagged, so it cannot be another
 *     cloud account's; and
 *   - it is REFERENCED by the records being promoted, which is what makes it
 *     this workspace's rather than a leftover from some earlier account.
 *
 * Records belonging to a previous cloud account carry that account's keys, so
 * they match nothing here and nothing of theirs moves.
 *
 * Partial results are reported, never swallowed. The keys that did not move
 * come back so the caller can decline to record the promotion as finished and
 * let a later load try again.
 *
 * @returns how many entries changed hands, and which ones did not.
 */
export async function adoptVaultEntries(
  referencedKeys: Iterable<string>,
  fromOwner: string,
  toOwner: string,
): Promise<{ adopted: number; failed: string[] }> {
  if (!isLocalFileVaultAvailable() || fromOwner === toOwner) return { adopted: 0, failed: [] };

  const referenced = new Set(referencedKeys);
  if (referenced.size === 0) return { adopted: 0, failed: [] };

  const failed: string[] = [];
  let adopted = 0;

  let stored: LocalFileSummary[];
  try {
    stored = await listLocalFiles();
  } catch (error) {
    // The vault could not be listed, so nothing is known about any of it. Every
    // requested key is unresolved rather than silently fine.
    console.warn('Listing this device\u2019s files for the workspace move failed.', error);
    return { adopted: 0, failed: [...referenced] };
  }

  for (const entry of stored) {
    if (!referenced.has(entry.key)) continue;
    if (entry.workspaceId !== undefined && entry.workspaceId !== fromOwner) continue;

    /*
     * Per entry, so one unreadable file does not abandon the rest — and so the
     * ones that did not move are NAMED. Reporting a partial move as success is
     * what makes it permanent: the caller marks the records as the new owner's,
     * reconciliation settles, and the entries still tagged `fromOwner` are
     * refused by every ownership check for as long as the session lasts.
     */
    try {
      const full = await readLocalFile(entry.key);
      if (!full) {
        failed.push(entry.key);
        continue;
      }
      await withStore('readwrite', (store) => store.put({ ...full, workspaceId: toOwner }));
      adopted += 1;
    } catch (error) {
      console.warn('Moving one of this device\u2019s files to the new workspace failed.', error);
      failed.push(entry.key);
    }
  }

  return { adopted, failed };
}

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
 * Remove every file this device is holding.
 *
 * For account deletion, which clears the workspace database and the in-memory
 * state but knew nothing about this one — so registration papers, receipts and
 * generated packets stayed on disk while the UI reported the account
 * permanently deleted.
 *
 * Deletes the whole database rather than each entry, so nothing survives a
 * partially-failed loop. Never throws: the account is already gone server-side
 * by the time this runs, and an exception here would leave the user staring at
 * a deletion error for data that is genuinely deleted.
 */
export async function clearLocalFileVault(
  workspaceId: string,
  alsoDeleteKeys: Iterable<string> = [],
): Promise<{ cleared: boolean }> {
  const factory = getIndexedDb();
  // Nothing to clear, which is a clean outcome rather than a failed one.
  if (!factory) return { cleared: true };

  try {
    /*
     * Delete this workspace's files, not the database.
     *
     * `deleteDatabase` drops the whole origin-wide vault, and now that entries
     * record an owner that is plainly the wrong tool: deleting one cloud
     * account from a browser that also holds another would take the other
     * account's registration papers, receipts and packets with it, permanently,
     * and the person would only find out when those records came back pointing
     * at nothing.
     *
     * `alsoDeleteKeys` carries the keys the departing workspace's own records
     * referenced. That is what covers files stored before ownership was
     * recorded: an untagged file cannot be swept on a guess, but one this
     * workspace demonstrably used is provably its own, and leaving a rancher's
     * documents behind after they deleted their account is its own kind of
     * wrong.
     */
    const stored = await listLocalFiles();
    const byKey = new Map(stored.map((entry) => [entry.key, entry]));

    const owned = new Set<string>();
    for (const key of alsoDeleteKeys) {
      const entry = byKey.get(key);
      if (!entry) continue;
      /*
       * Referenced is not the same as owned, and the difference destroys data.
       * A restored record can carry another workspace's key — an omitted file
       * is never remapped — so deleting everything this workspace referenced
       * took the other account's document with it. Untagged stays adoptable, as
       * described above; a proven foreign owner is left alone.
       */
      if (mayReadVaultEntry(entry, workspaceId)) owned.add(key);
    }
    for (const entry of stored) {
      if (entry.workspaceId === workspaceId) owned.add(entry.key);
    }

    for (const key of owned) {
      await deleteLocalFile(key);
    }

    return { cleared: true };
  } catch (error) {
    // Reported, not swallowed. A browser that refuses the deletion leaves
    // registration papers and receipts on the device, and the account screen
    // was saying "permanently deleted" over the top of them.
    console.error("Clearing this device's files failed.", error);
    return { cleared: false };
  }
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
export async function sweepLocalFileVault(referencedKeys: Iterable<string>, workspaceId: string): Promise<number> {
  if (!isLocalFileVaultAvailable()) return 0;

  try {
    const stored = await listLocalFiles();
    const referenced = new Set(referencedKeys);

    /*
     * Only files this workspace owns are candidates.
     *
     * The vault is origin-wide and a workspace is not, so "in the vault but not
     * referenced here" never meant "orphaned" — for a browser holding two
     * accounts it meant "belongs to the other one". Sweeping on that reading
     * deleted workspace A's device-only files the first time workspace B
     * hydrated, permanently, and left A's records pointing at nothing.
     */
    const mine = stored.filter((entry) => entry.workspaceId === workspaceId);
    const orphans = orphanedVaultKeys(
      mine.map((entry) => entry.key),
      referenced,
    );
    for (const key of orphans) {
      await deleteLocalFile(key);
    }

    /*
     * Adopt untagged files this workspace demonstrably uses.
     *
     * Entries written before ownership was recorded cannot be swept — unowned
     * is indistinguishable from someone else's. But one that THIS workspace
     * references is proven to be ours, so claiming it means it can be cleaned up
     * later instead of lingering forever.
     */
    for (const entry of stored) {
      if (entry.workspaceId !== undefined || !referenced.has(entry.key)) continue;
      const full = await readLocalFile(entry.key);
      if (full) await withStore('readwrite', (store) => store.put({ ...full, workspaceId }));
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
  /**
   * False when the file is not safe to render in a tab under this origin, and
   * must be downloaded instead. The url is already re-typed inert in that case.
   */
  inlineSafe: boolean;
  release: () => void;
}

/**
 * Types a stored file may be VIEWED as, in a tab, under this app's origin.
 *
 * An allowlist, and the reason is that an object URL is same-origin with the
 * page that created it. Navigating a tab to one runs the file as a document
 * belonging to XBAR — so an active format can read `localStorage` and the whole
 * IndexedDB workspace and ship it anywhere.
 *
 * SVG is the sharp case and the reason this exists: it is an executable
 * document that every `accept="image/*"` input takes without comment, so a
 * seller can be sent one, file it as a horse photo, and hand it script
 * execution in their own workspace by clicking "Open file". The deployed CSP
 * blocks inline scripts, but local and static-preview builds are supported
 * modes that ship no CSP at all, and a control that only works on one host is
 * not a control.
 *
 * PDF is included deliberately: browsers render it in their own sandboxed
 * viewer rather than as a same-origin document.
 */
const INLINE_VIEWABLE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'text/plain',
]);

/** Whether a stored file may be rendered in a tab rather than downloaded. */
export function isInlineViewableType(type: string): boolean {
  return INLINE_VIEWABLE_TYPES.has(type.trim().toLowerCase().split(';')[0].trim());
}

/**
 * Resolve a vault key to something the browser can open.
 *
 * Returns null when the key is not in the vault — the file was stored on a
 * different device, or browser storage was cleared. That is a real state a
 * local-first workspace can be in, and the caller has to say so rather than
 * showing a broken link.
 *
 * Anything outside the inline allowlist is handed back re-typed as
 * `application/octet-stream` and flagged `inlineSafe: false`. Both halves
 * matter: the flag lets the caller offer a download instead of a tab, and the
 * re-typing means a caller that navigates anyway downloads an inert blob rather
 * than executing it. The guarantee belongs here, at the one place object URLs
 * are minted, rather than in each of the four screens that open files.
 */
export async function openLocalFile(key: string, workspaceId: string): Promise<LocalFileHandle | null> {
  const entry = await readLocalFile(key);
  if (!entry) return null;

  /*
   * A key on a record is not permission to read the bytes behind it.
   *
   * The vault is origin-wide, and a key can reach a record that does not own
   * it: restoring workspace A's backup into workspace B copies A's
   * `localFileKey` onto B's records whenever the file itself was omitted from
   * the archive, so `importLocalFiles` never remapped it. Opening on the key
   * alone then handed B a document belonging to A.
   *
   * Untagged entries are allowed through. They predate ownership being
   * recorded, so unowned is indistinguishable from mine — and refusing them
   * would lock people out of their own files. Only a PROVEN foreign owner is
   * refused, which is the mirror of the sweep's rule: it deletes only what it
   * can prove is its own, and this reads everything except what it can prove is
   * someone else's.
   */
  if (!mayReadVaultEntry(entry, workspaceId)) return null;

  hookPageUnload();
  /*
   * A file XBAR generated may render; a file a person supplied may not.
   *
   * The allowlist below is about untrusted content, and a sale packet is not
   * untrusted — this app wrote every byte of it, and its inline verifier is the
   * script whose hash `vercel.json` allows precisely so it runs. Sending it
   * down the download path made that allowance dead code and told the seller
   * their packet had opened in a tab that did not exist.
   */
  const inlineSafe = entry.generated === true || isInlineViewableType(entry.type);
  const blob = inlineSafe ? entry.blob : new Blob([entry.blob], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  outstandingUrls.add(url);

  return {
    url,
    name: entry.name,
    type: entry.type,
    size: entry.size,
    inlineSafe,
    release: () => {
      if (!outstandingUrls.delete(url)) return;
      URL.revokeObjectURL(url);
    },
  };
}

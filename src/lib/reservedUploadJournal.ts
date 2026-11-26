import type { UploadIdentity, UploadJournal, UploadRecovery } from './reservedUploadClient.js';

const PREFIX = 'xbar-upload-recovery:';
const ORIGINALS_DB = 'xbar-upload-originals';
const ORIGINALS_STORE = 'upload-originals';
const inMemoryOriginals = new Map<string, Blob>();

function storage() {
  if (typeof window === 'undefined') throw Error('Device recovery storage is unavailable.');
  return window.localStorage;
}
function metadata(record: UploadRecovery) {
  const { original: _original, ...saved } = record;
  return saved;
}
function parse(value: string | null): UploadRecovery | null {
  if (!value) return null;
  const parsed = JSON.parse(value) as UploadRecovery;
  if (
    !parsed ||
    typeof parsed.requestId !== 'string' ||
    typeof parsed.target?.userId !== 'string' ||
    typeof parsed.target?.workspaceId !== 'string' ||
    typeof parsed.bucket !== 'string' ||
    !Number.isSafeInteger(parsed.sizeBytes) ||
    parsed.sizeBytes <= 0
  )
    throw Error('The upload recovery metadata is invalid.');
  return parsed;
}
async function originalStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  if (!globalThis.indexedDB) throw Error('Original retention is unavailable.');
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(ORIGINALS_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(ORIGINALS_STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? Error('Original retention could not be opened.'));
    request.onblocked = () => reject(Error('Original retention is blocked by another tab.'));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(ORIGINALS_STORE, mode);
      const request = run(transaction.objectStore(ORIGINALS_STORE));
      // A successful request can still roll back at commit (device quota).
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? Error('Original retention did not commit.'));
    });
  } finally {
    database.close();
  }
}

/** Metadata is mandatory; duplicating a large original is deliberately best effort. */
export const reservedUploadJournal: UploadJournal = {
  async put(record) {
    const encoded = JSON.stringify(metadata(record));
    const key = `${PREFIX}${record.requestId}`;
    storage().setItem(key, encoded);
    if (storage().getItem(key) !== encoded) throw Error('Device recovery metadata did not persist.');
    if (record.original) inMemoryOriginals.set(record.requestId, record.original);
    window.dispatchEvent?.(new Event('xbar-upload-recovery'));
  },
  async retainOriginal(record, original) {
    await originalStore('readwrite', (store) =>
      store.put({
        key: record.requestId,
        userId: record.target.userId,
        workspaceId: record.target.workspaceId,
        original,
      }),
    );
    return true;
  },
  async get(requestId) {
    const record = parse(storage().getItem(`${PREFIX}${requestId}`));
    if (!record || record.requestId !== requestId) return null;
    let original = inMemoryOriginals.get(requestId);
    if (!original && record.originalRetention === 'device') {
      try {
        const retained = await originalStore('readonly', (store) => store.get(requestId));
        if (
          retained?.userId === record.target.userId &&
          retained?.workspaceId === record.target.workspaceId &&
          retained.original instanceof Blob &&
          retained.original.size === record.sizeBytes
        )
          original = retained.original;
      } catch {
        /* Status and cancellation still work without access to the original. */
      }
    }
    return { ...record, ...(original ? { original } : {}) };
  },
};

/** Read only the current account/ranch metadata, without loading every original. */
export function listReservedUploadRecovery(target: UploadIdentity): UploadRecovery[] {
  const saved = storage();
  const records: UploadRecovery[] = [];
  for (let i = 0; i < saved.length; i += 1) {
    const key = saved.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const record = parse(saved.getItem(key));
    if (record && record.target.userId === target.userId && record.target.workspaceId === target.workspaceId)
      records.push(record);
  }
  return records;
}

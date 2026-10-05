import { resolveStoredFileAccess } from './resolveStoredFileAccess.js';
import { getDocumentAccessUrl } from './cloudWorkspace.js';
import { saveBlobAsFile } from './fileDownload.js';
import { isNavigableFileUrl } from './navigableFileUrl.js';
import type { StoredFileRef } from './storedFiles.js';

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const CHANGED = 'The selected document or ranch changed. Open the document again to download it.';

/** Resolve the canonical original, then hand its actual bytes to the existing web/native save helper. */
export async function downloadStoredFile(
  record: StoredFileRef & { fileName?: string; title?: string },
  isCurrent: () => boolean = () => true,
  dependencies = { getDocumentAccessUrl, saveBlobAsFile, fetch: globalThis.fetch },
  timeoutMs = 30_000,
): Promise<{ ok: true; via: 'browser' | 'share-sheet' } | { ok: false; message: string }> {
  const deadline = Date.now() + timeoutMs;
  let release: (() => void) | undefined;
  const check = () => {
    if (!isCurrent()) throw new Error(CHANGED);
  };
  try {
    check();
    const access = await resolveStoredFileAccess(record, isCurrent, timeoutMs, dependencies.getDocumentAccessUrl);
    if (!access.ok) return access;
    release = access.release;
    check();
    if (!isNavigableFileUrl(access.url)) throw new Error('The original has an unsupported file address.');
    const response = await dependencies.fetch.call(globalThis, access.url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
    check();
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('The original file could not be downloaded. Try Open file instead.');
    }
    if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
      await response.body.cancel().catch(() => undefined);
      throw new Error('This file is larger than the 64 MB download limit. Use Open file to access the original.');
    }
    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        check();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_DOWNLOAD_BYTES)
          throw new Error('This file is larger than the 64 MB download limit. Use Open file to access the original.');
        chunks.push(new Uint8Array(value).buffer);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (!size) throw new Error('The original file was empty. Nothing was saved.');
    check();
    const name = (access.fileName || record.fileName || record.title || 'document')
      .replace(/[\\/:*?"<>|]/g, '-')
      .slice(0, 180);
    const result = await dependencies.saveBlobAsFile(name, new Blob(chunks, { type: 'application/octet-stream' }));
    return result.ok ? result : { ok: false, message: result.reason };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'The original file could not be downloaded.',
    };
  } finally {
    release?.();
  }
}

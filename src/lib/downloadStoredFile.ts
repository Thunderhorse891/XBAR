import { resolveStoredFileAccess } from './resolveStoredFileAccess.js';
import { getDocumentAccessUrl } from './cloudWorkspace.js';
import { saveBlobAsFile } from './fileDownload.js';
import { isNavigableFileUrl } from './navigableFileUrl.js';
import type { StoredFileRef } from './storedFiles.js';

export const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const CHANGED = 'The selected document or ranch changed. Open the document again to download it.';

/** Resolve and read the canonical original with the same identity, size and time bounds for every consumer. */
export async function readStoredFile(
  record: StoredFileRef & { fileName?: string; title?: string },
  isCurrent: () => boolean = () => true,
  dependencies = { getDocumentAccessUrl, fetch: globalThis.fetch },
  timeoutMs = 30_000,
  maxBytes = MAX_DOWNLOAD_BYTES,
): Promise<{ ok: true; name: string; blob: Blob } | { ok: false; message: string }> {
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
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body.cancel().catch(() => undefined);
      throw new Error('This original exceeds the available download size budget. Use Open file to access it.');
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
        if (size > maxBytes)
          throw new Error('This original exceeds the available download size budget. Use Open file to access it.');
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
    return {
      ok: true,
      name,
      blob: new Blob(chunks, {
        type: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
      }),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'The original file could not be downloaded.',
    };
  } finally {
    release?.();
  }
}

/** Hand verified original bytes to the existing web/native save helper. */
export async function downloadStoredFile(
  record: StoredFileRef & { fileName?: string; title?: string },
  isCurrent: () => boolean = () => true,
  dependencies = { getDocumentAccessUrl, saveBlobAsFile, fetch: globalThis.fetch },
  timeoutMs = 30_000,
): Promise<{ ok: true; via: 'browser' | 'share-sheet' } | { ok: false; message: string }> {
  try {
    const read = await readStoredFile(record, isCurrent, dependencies, timeoutMs);
    if (!read.ok) return read;
    if (!isCurrent()) return { ok: false, message: CHANGED };
    const saved = await dependencies.saveBlobAsFile(
      read.name,
      new Blob([read.blob], { type: 'application/octet-stream' }),
    );
    return saved.ok ? saved : { ok: false, message: saved.reason };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'The original file could not be downloaded.',
    };
  }
}

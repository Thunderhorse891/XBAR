import { getDocumentAccessUrl } from './cloudWorkspace.js';
import type { StoredFileRef } from './storedFiles.js';

export const FILE_CONTEXT_CHANGED = 'The selected document or ranch changed. Open the document again.';
export const FILE_ACCESS_TIMEOUT = 'The original file took too long to open. Check your connection and try again.';

/** Bound auth, signing and local-vault resolution too, and release handles that arrive after cancellation. */
export async function resolveStoredFileAccess(
  record: StoredFileRef,
  isCurrent: () => boolean,
  timeoutMs = 30_000,
  resolve = getDocumentAccessUrl,
): ReturnType<typeof getDocumentAccessUrl> {
  if (!isCurrent()) return { ok: false, message: FILE_CONTEXT_CHANGED };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = resolve(record).then((access) => {
    if (stopped || !isCurrent()) {
      if (access.ok) access.release?.();
      return { ok: false as const, message: FILE_CONTEXT_CHANGED };
    }
    return access;
  });
  try {
    return await Promise.race([
      request,
      new Promise<{ ok: false; message: string }>((done) => {
        timer = setTimeout(() => {
          stopped = true;
          done({ ok: false, message: FILE_ACCESS_TIMEOUT });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

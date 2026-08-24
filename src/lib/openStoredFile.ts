import { getDocumentAccessUrl } from '@/lib/cloudWorkspace';
import type { StoredFileRef } from '@/lib/storedFiles';

/*
 * Opening a stored file, wherever it is stored.
 *
 * Two screens do this — Documents and Expenses — and the sequence has three
 * details that are easy to get wrong separately: the tab has to be opened
 * before the first `await` or a popup blocker eats it, `opener` has to be
 * cleared so the new tab cannot reach back into the app, and an object URL for
 * a locally-held file has to be released or it pins the blob in memory for the
 * life of the page.
 */

/**
 * How long an object URL stays alive after the tab has been pointed at it.
 *
 * Revoking immediately races the new tab's own load, which fails silently and
 * intermittently — the worst kind of bug to chase. A minute is far longer than
 * any viewer needs to read the blob, and the vault revokes whatever is still
 * outstanding when the page goes away, so nothing survives past a reload.
 */
const OBJECT_URL_LIFETIME_MS = 60_000;

export type OpenStoredFileResult = { ok: true } | { ok: false; message: string };

export async function openStoredFileInTab(record: StoredFileRef): Promise<OpenStoredFileResult> {
  // Opened synchronously, before any await: a `window.open` that happens after
  // one is no longer attributable to the click and is blocked by default.
  const previewWindow = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  if (previewWindow) {
    previewWindow.opener = null;
  }

  const access = await getDocumentAccessUrl(record);

  if (!access.ok) {
    previewWindow?.close();
    return { ok: false, message: access.message };
  }

  const release = access.release;
  const scheduleRelease = () => {
    if (!release || typeof window === 'undefined') return;
    window.setTimeout(release, OBJECT_URL_LIFETIME_MS);
  };

  if (previewWindow) {
    previewWindow.location.href = access.url;
    previewWindow.focus();
    scheduleRelease();
    return { ok: true };
  }

  window.open(access.url, '_blank', 'noopener,noreferrer');
  scheduleRelease();
  return { ok: true };
}

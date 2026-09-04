import { getDocumentAccessUrl } from '@/lib/cloudWorkspace';
import { isNavigableFileUrl } from '@/lib/navigableFileUrl';
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

/**
 * How the file actually reached the person.
 *
 * Reported rather than assumed: an inert file is downloaded and no tab exists,
 * so a caller that says "opened in a new tab" for every success is telling the
 * seller to look at something that is not there. The caller phrases its own
 * copy from this.
 */
export type OpenStoredFileResult = { ok: true; delivery: 'tab' | 'download' } | { ok: false; message: string };

export async function openStoredFileInTab(record: StoredFileRef): Promise<OpenStoredFileResult> {
  // Opened synchronously, before any await: a `window.open` that happens after
  // one is no longer attributable to the click and is blocked by default.
  const previewWindow = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  if (previewWindow) {
    previewWindow.opener = null;
  }

  /*
   * Resolution can THROW, not merely return a failure.
   *
   * The vault rejects when IndexedDB is unreadable, and the Supabase client has
   * its own ways to blow up. An escaping rejection breaks this function's own
   * contract: the blank tab stays open on the screen, and Documents, Expenses
   * and the studio list never clear their "Opening..." state or show a toast,
   * because each of them only handles `{ ok: false }`. The result is a stuck
   * button and an empty tab, with no explanation anywhere.
   */
  let access: Awaited<ReturnType<typeof getDocumentAccessUrl>>;
  try {
    access = await getDocumentAccessUrl(record);
  } catch (error) {
    console.error('Resolving a stored file failed.', error);
    previewWindow?.close();
    return { ok: false, message: 'This file could not be read from storage. Try again in a moment.' };
  }

  if (!access.ok) {
    previewWindow?.close();
    return { ok: false, message: access.message };
  }

  /*
   * Checked again here, deliberately.
   *
   * `getDocumentAccessUrl` refuses a bad scheme at the source, which covers
   * every caller. This second check covers this FILE: the three sinks below —
   * a same-origin `location.href`, an `<a download>`, and `window.open` — are
   * where a URL stops being a string and starts being navigation, and the
   * assignment on line ~97 targets an `about:blank` this app opened, so it
   * inherits this origin.
   *
   * Two checks of one predicate, not two predicates: the rule lives in
   * `isNavigableFileUrl` and neither copy can drift from the other.
   */
  if (!isNavigableFileUrl(access.url)) {
    previewWindow?.close();
    access.release?.();
    return { ok: false, message: 'This file points at an address this app will not open.' };
  }

  const release = access.release;
  const scheduleRelease = () => {
    if (!release || typeof window === 'undefined') return;
    window.setTimeout(release, OBJECT_URL_LIFETIME_MS);
  };

  /*
   * A file that must not run as a document is downloaded, never navigated to.
   *
   * The vault has already re-typed it inert, so navigating would download it
   * anyway — but it would leave a blank tab sitting there while it did, and the
   * seller would think the click failed. Downloading is both the safe answer
   * and the honest one.
   */
  if (access.inlineSafe === false) {
    previewWindow?.close();
    if (typeof document !== 'undefined') {
      const link = document.createElement('a');
      link.href = access.url;
      link.download = access.fileName ?? 'download';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    scheduleRelease();
    return { ok: true, delivery: 'download' };
  }

  if (previewWindow) {
    previewWindow.location.href = access.url;
    previewWindow.focus();
    scheduleRelease();
    return { ok: true, delivery: 'tab' };
  }

  /*
   * Nothing was opened up front, so this is a second attempt after an await —
   * and by then the click no longer counts as user activation in most browsers,
   * so it is the attempt most likely to be blocked. Its return value is the
   * only signal that happened.
   *
   * Reporting `ok` here told the caller a tab had opened when none had. The
   * sale-packet wizard is where that bites: it resolves and stores the packet
   * before opening it, so the seller was told their packet was open in a new
   * tab, saw no tab, and had no idea the packet existed at all.
   */
  const opened = typeof window === 'undefined' ? null : window.open(access.url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    // Released immediately rather than on the timer: nothing consumed the URL,
    // so there is nothing to keep it alive for.
    release?.();
    return {
      ok: false,
      message: 'Your browser blocked the new tab. Allow pop-ups for this site, then try again.',
    };
  }

  scheduleRelease();
  return { ok: true, delivery: 'tab' };
}

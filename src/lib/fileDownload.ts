import { isNativeApp } from './nativePlatform.js';

/**
 * One place where XBAR turns generated content into a saved file.
 *
 * Every caller used to do this inline — create a blob URL, set `download` on an
 * anchor, click it — and then report success unconditionally. That is a lie in a
 * store build: iOS WKWebView ignores the `download` attribute, so the tap
 * produces no file, no error, and a toast saying the export worked. The July
 * audit removed exactly this pattern (a button reporting success with no
 * persistent evidence) from the web app; this keeps it out of the native one.
 *
 * Returning a result rather than throwing keeps the honest message next to the
 * action that failed, which is what the callers need to show the user.
 */
export type FileSaveResult = { ok: true } | { ok: false; reason: string };

const NATIVE_REASON =
  'Saving files to this device is not supported in the app yet. Open XBAR in a web browser to download it.';

export function canSaveFilesLocally(): boolean {
  return !isNativeApp() && typeof document !== 'undefined' && typeof URL.createObjectURL === 'function';
}

export function saveBlobAsFile(fileName: string, blob: Blob): FileSaveResult {
  if (isNativeApp()) return { ok: false, reason: NATIVE_REASON };
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { ok: false, reason: 'This browser cannot save files from XBAR.' };
  }

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.click();
    return { ok: true };
  } catch {
    return { ok: false, reason: 'The file could not be saved.' };
  } finally {
    // Revoke on the next tick rather than synchronously: revoking in the same
    // frame as the click can cancel the download that was just started.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function saveTextAsFile(fileName: string, text: string, mimeType: string): FileSaveResult {
  return saveBlobAsFile(fileName, new Blob([text], { type: mimeType }));
}

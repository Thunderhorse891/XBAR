import { hasNativeBridge, isNativeApp } from './nativePlatform.js';

/**
 * One place where XBAR turns generated content into a saved file.
 *
 * Every caller used to do this inline — create a blob URL, set `download` on an
 * anchor, click it — and then report success unconditionally. That is a lie in a
 * store build: iOS WKWebView ignores the `download` attribute, so the tap
 * produced no file, no error, and a toast saying the export worked.
 *
 * There are two real save paths, and the choice deliberately keys off different
 * signals:
 *
 *  - Native uses `hasNativeBridge()`, not `isNativeApp()`. The Capacitor plugins
 *    only function when the native bridge is actually present; the build-time
 *    VITE_NATIVE_APP flag says "this bundle is destined for a store build",
 *    which is the right signal for hiding a paywall early but the wrong one for
 *    calling a plugin that may not be there.
 *  - Web uses the anchor, which is what browsers support.
 *
 * Anything else returns a reason rather than throwing, because callers render
 * that text in a toast.
 */
export type FileSaveResult = { ok: true; via: 'browser' | 'share-sheet' } | { ok: false; reason: string };

export function canSaveFilesLocally(): boolean {
  if (hasNativeBridge()) return true;
  if (isNativeApp()) return false;
  return typeof document !== 'undefined' && typeof URL.createObjectURL === 'function';
}

/** UTF-8 safe base64, which is what Filesystem.writeFile expects. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function saveViaShareSheet(fileName: string, text: string): Promise<FileSaveResult> {
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);

    // Cache, not Documents: the file is a hand-off to the share sheet, not
    // something XBAR keeps. Writing to Documents would also require
    // UIFileSharingEnabled to be useful, which is a different decision.
    const written = await Filesystem.writeFile({
      path: fileName,
      data: toBase64(text),
      directory: Directory.Cache,
    });

    // The share sheet is what lets the customer put the file where they want —
    // Files, Mail, AirDrop. A plain write would leave it somewhere they cannot
    // reach, which is no better than the silent failure this replaces.
    await Share.share({ title: fileName, files: [written.uri] });
    return { ok: true, via: 'share-sheet' };
  } catch (error) {
    // A cancelled share sheet lands here too. Treating it as a failure is
    // deliberate: the file did not reach anywhere the customer chose, and
    // claiming otherwise is the behavior this whole change exists to remove.
    const detail = error instanceof Error ? error.message : '';
    return {
      ok: false,
      reason: detail.toLowerCase().includes('cancel')
        ? 'Export cancelled — nothing was saved.'
        : 'The file could not be shared from this device.',
    };
  }
}

function saveViaBrowser(fileName: string, blob: Blob): FileSaveResult {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.click();
    return { ok: true, via: 'browser' };
  } catch {
    return { ok: false, reason: 'The file could not be saved.' };
  } finally {
    // Revoke on the next tick rather than synchronously: revoking in the same
    // frame as the click can cancel the download that was just started.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function saveTextAsFile(fileName: string, text: string, mimeType: string): Promise<FileSaveResult> {
  if (hasNativeBridge()) return saveViaShareSheet(fileName, text);

  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return {
      ok: false,
      reason: isNativeApp()
        ? 'Saving files is unavailable because the app is still starting up. Try again in a moment.'
        : 'This browser cannot save files from XBAR.',
    };
  }

  return saveViaBrowser(fileName, new Blob([text], { type: mimeType }));
}

export async function saveBlobAsFile(fileName: string, blob: Blob): Promise<FileSaveResult> {
  if (hasNativeBridge()) return saveViaShareSheet(fileName, await blob.text());

  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { ok: false, reason: 'This browser cannot save files from XBAR.' };
  }

  return saveViaBrowser(fileName, blob);
}

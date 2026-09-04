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

/**
 * Base64 for Filesystem.writeFile, from raw bytes.
 *
 * Takes bytes rather than a string on purpose: routing a binary blob (a packet
 * PDF, a photo) through a text decode replaces every invalid UTF-8 sequence
 * with U+FFFD, so the file would arrive corrupted while the save still reported
 * success. Callers encode text to UTF-8 bytes themselves.
 *
 * Chunked because String.fromCharCode is applied to the whole array at once and
 * a multi-megabyte PDF would otherwise blow the argument limit.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

/*
 * Bytes read, encoded and handed to the filesystem at a time.
 *
 * A MULTIPLE OF 3, and that is the whole reason the append below is safe.
 * Base64 maps three bytes to four characters; a chunk that is a multiple of
 * three encodes with no padding, so the encoded chunks concatenate into exactly
 * the base64 of the whole file. Any other size pads mid-stream and corrupts
 * everything after it -- silently, since the file still writes.
 */
export const NATIVE_WRITE_CHUNK_BYTES = 3 * 256 * 1024;

/**
 * Write a blob to the native filesystem without ever holding it all at once.
 *
 * The obvious version -- `bytesToBase64(new Uint8Array(await blob.arrayBuffer()))` --
 * is what this replaces, and it cannot survive a large backup. A workspace
 * backup is capped at 200 MiB of SOURCE bytes (MAX_BACKUP_FILE_BYTES), which is
 * already ~267 MiB once its files are base64 inside the archive JSON. Buffering
 * that whole blob adds another ~267 MiB, the binary string another ~267 MiB, and
 * the base64 of it ~356 MiB -- roughly a gigabyte live at once, while the
 * archive itself is still referenced. An iOS WebView is killed well before
 * that, so the customer loses the app instead of getting the backup, on exactly
 * the export the limit was raised to permit.
 *
 * Slicing the Blob rather than buffering it keeps the peak at one chunk: the
 * browser reads only the requested range off disk.
 */
async function writeBlobInChunks(
  filesystem: typeof import('@capacitor/filesystem'),
  fileName: string,
  blob: Blob,
): Promise<string> {
  const { Filesystem, Directory } = filesystem;

  const first = await blob.slice(0, NATIVE_WRITE_CHUNK_BYTES).arrayBuffer();
  const written = await Filesystem.writeFile({
    path: fileName,
    data: bytesToBase64(new Uint8Array(first)),
    directory: Directory.Cache,
  });

  for (let offset = NATIVE_WRITE_CHUNK_BYTES; offset < blob.size; offset += NATIVE_WRITE_CHUNK_BYTES) {
    const slice = await blob.slice(offset, offset + NATIVE_WRITE_CHUNK_BYTES).arrayBuffer();
    await Filesystem.appendFile({
      path: fileName,
      data: bytesToBase64(new Uint8Array(slice)),
      directory: Directory.Cache,
    });
  }

  return written.uri;
}

async function saveViaShareSheet(fileName: string, blob: Blob): Promise<FileSaveResult> {
  let filesystem: typeof import('@capacitor/filesystem') | null = null;
  let wrote = false;

  try {
    const [fs, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    filesystem = fs;

    // Cache, not Documents: the file is a hand-off to the share sheet, not
    // something XBAR keeps. Writing to Documents would also require
    // UIFileSharingEnabled to be useful, which is a different decision.
    const uri = await writeBlobInChunks(fs, fileName, blob);
    wrote = true;

    // The share sheet is what lets the customer put the file where they want —
    // Files, Mail, AirDrop. A plain write would leave it somewhere they cannot
    // reach, which is no better than the silent failure this replaces.
    await Share.share({ title: fileName, files: [uri] });
    return { ok: true, via: 'share-sheet' };
  } catch (error) {
    // A cancelled share sheet lands here. Both platforms reject rather than
    // resolving: SharePlugin.swift calls `call.reject("Share canceled")` when
    // the activity controller reports `completed == false`, and the Android
    // plugin does the same. Treating it as a failure is deliberate — the file
    // did not reach anywhere the customer chose, and claiming otherwise is the
    // behavior this whole change exists to remove.
    const detail = error instanceof Error ? error.message : '';
    return {
      ok: false,
      reason: detail.toLowerCase().includes('cancel')
        ? 'Export cancelled — nothing was saved.'
        : 'The file could not be shared from this device.',
    };
  } finally {
    /*
     * The hand-off file is deleted whatever happened, and this matters beyond
     * tidiness.
     *
     * A workspace backup carries registration papers and receipts, and it was
     * being left in the app sandbox indefinitely -- surviving the share, a
     * cancellation, and account deletion, which tells the customer their
     * on-device files have been removed. iOS may evict a cache directory
     * eventually; "eventually" is not what that screen promises.
     *
     * Deleting after Share.share resolves is safe: the receiving app has taken
     * its own copy by then. A failure to delete is swallowed on purpose -- the
     * export already succeeded or already reported why it did not, and turning
     * a cleanup problem into a "your backup failed" message would be a lie in
     * the more alarming direction.
     */
    if (wrote && filesystem) {
      try {
        await filesystem.Filesystem.deleteFile({ path: fileName, directory: filesystem.Directory.Cache });
      } catch {
        /* the file stays until iOS evicts it; the export itself is unaffected */
      }
    }
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

/**
 * The browser anchor path is only ever valid outside a store build.
 *
 * A WKWebView supplies `document` and `URL.createObjectURL` like any browser, so
 * a DOM check alone does not keep a store build out of the anchor path — and
 * that path silently does nothing on iOS while still reporting success. This is
 * the ordering `canSaveFilesLocally()` already used; the save functions now
 * agree with it.
 */
function saveUnavailableReason(): string | null {
  if (isNativeApp()) {
    return 'Saving files is unavailable because the app is still starting up. Try again in a moment.';
  }
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return 'This browser cannot save files from XBAR.';
  }
  return null;
}

export async function saveTextAsFile(fileName: string, text: string, mimeType: string): Promise<FileSaveResult> {
  if (hasNativeBridge()) return saveViaShareSheet(fileName, new Blob([text], { type: mimeType }));

  const unavailable = saveUnavailableReason();
  if (unavailable) return { ok: false, reason: unavailable };

  return saveViaBrowser(fileName, new Blob([text], { type: mimeType }));
}

export async function saveBlobAsFile(fileName: string, blob: Blob): Promise<FileSaveResult> {
  // The Blob itself, not its bytes: writeBlobInChunks slices it so a large
  // backup never has to exist in memory twice over.
  if (hasNativeBridge()) return saveViaShareSheet(fileName, blob);

  const unavailable = saveUnavailableReason();
  if (unavailable) return { ok: false, reason: unavailable };

  return saveViaBrowser(fileName, blob);
}

// One way to hand a generated file to the user, on every platform XBAR ships.
//
// The browser path is an <a download> click. That does nothing at all inside
// an iOS WKWebView: there is no download manager, and the `download`
// attribute is ignored — the button appears to work and no file ever appears.
// Every export in the app went through that path, so in the native build they
// were silently dead. Here the native build writes the file into the app's
// cache directory and opens the system share sheet instead ("Save to Files",
// Mail, AirDrop, …), which is the iOS equivalent of a download.
//
// The Capacitor plugins are loaded with a dynamic import so the web bundle
// splits them into a chunk it never fetches.

import { isNativeApp } from './nativeRuntime.js';

export type FileDeliveryResult = {
  ok: boolean;
  /** How the file reached the user — useful for honest toast copy. */
  method: 'download' | 'share' | 'none';
  message: string;
};

export type FileDeliveryInput = {
  fileName: string;
  /** File body. Text is written as UTF-8. */
  contents: string | Blob;
  mimeType: string;
  /** Title shown above the iOS share sheet. */
  shareTitle?: string;
};

function toBlob(input: FileDeliveryInput) {
  return input.contents instanceof Blob ? input.contents : new Blob([input.contents], { type: input.mimeType });
}

function downloadInBrowser(input: FileDeliveryInput): FileDeliveryResult {
  let url = '';
  try {
    url = URL.createObjectURL(toBlob(input));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = input.fileName;
    anchor.click();
    return { ok: true, method: 'download', message: `${input.fileName} downloaded.` };
  } catch {
    return { ok: false, method: 'none', message: 'The file could not be prepared for download.' };
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

async function toBase64(blob: Blob) {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked so a large packet does not blow the argument limit of
  // String.fromCharCode with a spread of the whole array.
  const chunkSize = 0x8000;
  for (let index = 0; index < buffer.length; index += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function shareFromNative(input: FileDeliveryInput): Promise<FileDeliveryResult> {
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);

    // Cache, not Documents: these are hand-off artifacts, and the OS is free
    // to reclaim them once the share sheet is done.
    const written = await Filesystem.writeFile({
      path: input.fileName,
      data: await toBase64(toBlob(input)),
      directory: Directory.Cache,
    });

    await Share.share({
      title: input.shareTitle ?? input.fileName,
      files: [written.uri],
    });

    return { ok: true, method: 'share', message: `${input.fileName} is ready to save or send.` };
  } catch (error) {
    // A user dismissing the share sheet rejects the promise on iOS. That is a
    // cancellation, not a failure, and must not surface as an error toast.
    if (error instanceof Error && /cancel/i.test(error.message)) {
      return { ok: true, method: 'share', message: 'Sharing canceled.' };
    }

    return { ok: false, method: 'none', message: 'The file could not be shared from this device.' };
  }
}

/**
 * Save or share a generated file. Resolves once the browser download has been
 * triggered, or once the native share sheet has been dismissed.
 */
export async function deliverFile(input: FileDeliveryInput): Promise<FileDeliveryResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { ok: false, method: 'none', message: 'Files can only be saved from the app.' };
  }

  return isNativeApp() ? shareFromNative(input) : downloadInBrowser(input);
}

/** Verb for this platform, so toast copy never promises the wrong thing. */
export function fileDeliveryVerb() {
  return isNativeApp() ? 'shared' : 'downloaded';
}

/** Button label matching what tapping it actually does on this platform. */
export function fileDeliveryActionLabel() {
  return isNativeApp() ? 'Share' : 'Download';
}

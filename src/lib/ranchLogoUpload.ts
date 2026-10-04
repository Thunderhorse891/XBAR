import { MAX_PACKET_LOGO_BYTES, validatePacketLogo } from '../../api/_lib/packet-branding.js';

/** Reads only a local file. Decoding and re-encoding discards metadata and any
 * extra payload; no remote URL is ever resolved or stored in the profile. */
export async function readRanchLogo(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > MAX_PACKET_LOGO_BYTES) {
    throw new Error('Choose a PNG or JPEG logo under 256 KB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const dataUrl = `data:${file.type};base64,${btoa(binary)}`;
  const logo = validatePacketLogo(dataUrl);
  if (!logo) throw new Error('The logo file is empty.');

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      reject(new Error('The logo could not be read. Choose the file again.'));
    }, 15_000);
    image.onload = () => {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      reject(new Error('The file is not a readable PNG or JPEG image.'));
    };
    image.src = logo.dataUrl;
  });
  if (image.naturalWidth !== logo.width || image.naturalHeight !== logo.height) {
    throw new Error('The logo dimensions could not be verified. Export a PNG or JPEG and try again.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = logo.width;
  canvas.height = logo.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not prepare the logo. Try again in another browser.');
  context.drawImage(image, 0, 0);
  // Keep JPEG compression: a small photographic JPEG can expand beyond the
  // byte limit when rendered as lossless PNG. Re-encoding still removes the
  // original metadata/payload; lower JPEG quality only when needed to fit.
  let safeDataUrl = canvas.toDataURL(logo.mimeType, 0.92);
  if (logo.mimeType === 'image/jpeg') {
    for (const quality of [0.8, 0.6, 0.4, 0.2, 0]) {
      if (atob(safeDataUrl.split(',')[1] || '').length <= MAX_PACKET_LOGO_BYTES) break;
      safeDataUrl = canvas.toDataURL('image/jpeg', quality);
    }
  }
  validatePacketLogo(safeDataUrl);
  return safeDataUrl;
}

/* One browser/server contract for buyer-facing ranch identity. Logos are small,
 * self-contained raster files, never URLs: packet generation cannot fetch them. */
import { isQuickStartSentinel } from './workspace-identity.js';

export const MAX_PACKET_LOGO_BYTES = 256 * 1024;
export const MAX_PACKET_LOGO_DIMENSION = 2048;
const LOGO_ERROR = 'Choose a valid PNG or JPEG logo under 256 KB and no larger than 2048 × 2048 pixels.';
function logoError() {
  throw new Error(LOGO_ERROR);
}
function dimensions(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_PACKET_LOGO_DIMENSION ||
    height > MAX_PACKET_LOGO_DIMENSION
  )
    logoError();
  return { width, height };
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngDimensions(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) logoError();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let size;
  let imageData = false;
  let ended = false;
  let palette = 0;
  let dataEnded = false;
  let transparency = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) logoError();
    const kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (
      !/^[A-Za-z]{4}$/.test(kind) ||
      !/[A-Z]/.test(kind[2]) ||
      (/^[A-Z]/.test(kind) && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(kind))
    )
      logoError();
    const end = offset + 8 + length;
    if (view.getUint32(end) !== crc32(bytes.subarray(offset + 4, end))) logoError();
    if (!size) {
      if (kind !== 'IHDR' || length !== 13) logoError();
      size = dimensions(view.getUint32(offset + 8), view.getUint32(offset + 12));
      if (bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) logoError();
    } else if (kind === 'IHDR') logoError();
    if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') logoError(); // no animated PNG
    const color = bytes[25];
    if (kind === 'PLTE') {
      if (palette || imageData || [0, 4].includes(color) || length < 3 || length > 768 || length % 3) logoError();
      palette = length / 3;
      if (color === 3 && palette > 2 ** bytes[24]) logoError();
    }
    if (kind === 'tRNS') {
      if (
        transparency ||
        imageData ||
        (color === 3 && (!palette || length > palette)) ||
        (color === 0 && length !== 2) ||
        (color === 2 && length !== 6) ||
        [4, 6].includes(color)
      )
        logoError();
      transparency = true;
    }
    if (kind === 'IDAT') {
      if (dataEnded || (color === 3 && !palette)) logoError();
      imageData = true;
    } else if (imageData) dataEnded = true;
    offset = end + 4;
    if (kind === 'IEND') {
      if (length !== 0 || !imageData || offset !== bytes.length) logoError();
      ended = true;
      break;
    }
  }
  if (!ended || !size) logoError();
  return size;
}
function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) logoError();
  let offset = 2;
  let size;
  let scan = false;
  let ended = false;
  while (offset + 2 <= bytes.length) {
    if (bytes[offset++] !== 255) logoError();
    while (bytes[offset] === 255) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!scan || offset !== bytes.length) logoError();
      ended = true;
      break;
    }
    if (marker === 0xdc || marker === 0xd8 || marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) logoError();
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length - 2) logoError();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const components = bytes[offset + 7];
      if (size || length !== 8 + 3 * components || ![1, 3, 4].includes(components) || bytes[offset + 2] !== 8)
        logoError();
      size = dimensions((bytes[offset + 5] << 8) | bytes[offset + 6], (bytes[offset + 3] << 8) | bytes[offset + 4]);
      const ids = new Set();
      let blocks = 0;
      for (let c = 0; c < components; c += 1) {
        const id = bytes[offset + 8 + 3 * c];
        const sampling = bytes[offset + 9 + 3 * c];
        const h = sampling >> 4;
        const v = sampling & 15;
        if (ids.has(id) || h < 1 || h > 4 || v < 1 || v > 4) logoError();
        ids.add(id);
        blocks += h * v;
      }
      if (blocks > 10) logoError();
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) logoError();
    if (marker === 0xda) {
      const components = bytes[offset + 2];
      if (!size || components < 1 || components > 4 || length !== 6 + 2 * components) logoError();
      offset += length;
      let entropy = false;
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) {
          entropy = true;
          offset += 1;
          continue;
        }
        if (bytes[offset + 1] === 0) {
          entropy = true;
          offset += 2;
          continue;
        }
        if (bytes[offset + 1] >= 0xd0 && bytes[offset + 1] <= 0xd7) {
          offset += 2;
          continue;
        }
        break;
      }
      if (!entropy) logoError();
      scan = true;
    } else offset += length;
  }
  if (!size || !scan || !ended) logoError();
  return size;
}
export function validatePacketLogo(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_PACKET_LOGO_BYTES / 3) * 4 + 32) logoError();
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) logoError();
  let raw;
  try {
    raw = atob(match[2]);
  } catch {
    logoError();
  }
  if (!raw || raw.length > MAX_PACKET_LOGO_BYTES || btoa(raw) !== match[2]) logoError();
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  const size = match[1] === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes);
  return { dataUrl: value, mimeType: match[1], bytes, ...size };
}
function text(value, limit, label) {
  if (value === undefined || value === null) return '';
  if (
    typeof value !== 'string' ||
    value.length > limit ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error(`${label} must be plain text, at most ${limit} characters.`);
  return value.trim();
}
export function normalizePacketWebsite(value) {
  const raw = text(value, 240, 'Website');
  if (!raw) return '';
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error('Website must be a valid http or https address.');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    !url.hostname.includes('.') ||
    url.username ||
    url.password ||
    /\s/.test(raw)
  )
    throw new Error('Website must be a valid http or https address without credentials.');
  return url.href;
}
export function validatePacketProfile(profile) {
  for (const [field, label, limit] of [
    ['businessName', 'Business name', 160],
    ['ranchName', 'Ranch name', 160],
    ['defaultOwnerName', 'Owner name', 160],
    ['ranchManagerName', 'Manager name', 160],
    ['operationsEmail', 'Operations email', 254],
    ['contactPhone', 'Contact phone', 80],
  ])
    text(profile?.[field], limit, label);
  normalizePacketWebsite(profile?.website);
  validatePacketLogo(profile?.packetLogoDataUrl);
}
export function normalizePacketBranding(profile = {}) {
  validatePacketProfile(profile);
  const clean = (value, limit, label) => {
    const result = text(value, limit, label);
    return isQuickStartSentinel(result) ? '' : result;
  };
  const name =
    clean(profile.defaultOwnerName, 160, 'Seller name') || clean(profile.ranchManagerName, 160, 'Seller name');
  const ranch = clean(profile.ranchName, 160, 'Ranch name');
  const business = clean(profile.businessName, 160, 'Business name');
  const email = clean(profile.operationsEmail, 254, 'Operations email');
  const logo = validatePacketLogo(profile.packetLogoDataUrl);
  return {
    name,
    ranch,
    business,
    email,
    phone: text(profile.contactPhone, 80, 'Contact phone'),
    website: normalizePacketWebsite(profile.website),
    displayName: ranch || business,
    logoDataUrl: logo?.dataUrl || '',
    logoMimeType: logo?.mimeType || '',
    logoWidth: logo?.width || 0,
    logoHeight: logo?.height || 0,
    logoBytes: logo?.bytes || null,
  };
}

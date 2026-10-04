import { validatePacketLogo } from './packet-branding.js';

// Web Streams API works in both the browser and the supported Node runtime.
async function validatePngRaster(logo) {
  const { bytes, width, height } = logo;
  const depth = bytes[24];
  const color = bytes[25];
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const allowedDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!channels || !allowedDepths[color].includes(depth)) throw new Error('Invalid PNG color format.');
  const passes =
    bytes[28] === 0
      ? [[0, 0, 1, 1]]
      : [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ];
  const rowLengths = [];
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = Math.max(0, Math.ceil((width - startX) / stepX));
    const passHeight = Math.max(0, Math.ceil((height - startY) / stepY));
    if (!passWidth || !passHeight) continue;
    const rowLength = 1 + Math.ceil((passWidth * channels * depth) / 8);
    for (let row = 0; row < passHeight; row += 1) rowLengths.push(rowLength);
  }
  const expected = rowLengths.reduce((sum, length) => sum + length, 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compressed = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') {
      compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const reader = new Blob(compressed).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let consumed = 0;
  let nextRow = 0;
  let rowIndex = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (consumed + value.length > expected) {
        await reader.cancel();
        throw new Error('PNG raster exceeds its declared dimensions.');
      }
      while (rowIndex < rowLengths.length && nextRow < consumed + value.length) {
        if (value[nextRow - consumed] > 4) {
          await reader.cancel();
          throw new Error('Invalid PNG scanline filter.');
        }
        nextRow += rowLengths[rowIndex++];
      }
      consumed += value.length;
    }
    if (consumed !== expected) throw new Error('Incomplete PNG raster.');
  } finally {
    reader.releaseLock();
  }
}

/** Bounded content validation shared by profile saves, local packets and PDFs. */
export async function validatePacketLogoRaster(value) {
  const customerLogo = validatePacketLogo(value);
  if (!customerLogo) return null;
  try {
    if (customerLogo.mimeType === 'image/jpeg') {
      // pdf-lib embeds JPEG bytes after reading only the header. Decode the
      // bounded raster first, otherwise a structurally plausible but broken
      // logo can yield a successful PDF with a missing customer image.
      const { JpegImage } = await import('pdfjs-dist/image_decoders/pdf.image_decoders.mjs');
      const decoded = new JpegImage();
      // This decoder repairs an early EOI by padding missing blocks. A legal
      // empty comment before the final EOI is accepted after a complete scan,
      // but makes a truncated scan throw instead of silently repairing it.
      // Only the validation copy changes; the original logo bytes are sealed
      // and embedded below.
      const validationBytes = new Uint8Array(customerLogo.bytes.length + 4);
      validationBytes.set(customerLogo.bytes.subarray(0, -2));
      validationBytes.set([0xff, 0xfe, 0, 2, 0xff, 0xd9], customerLogo.bytes.length - 2);
      decoded.parse(validationBytes, { dnlScanLines: customerLogo.height });
      if (decoded.width !== customerLogo.width || decoded.height !== customerLogo.height) {
        throw new Error('Logo dimensions changed during decoding.');
      }
      const pixels = decoded.getData({ width: decoded.width, height: decoded.height, forceRGBA: true });
      if (pixels.length !== decoded.width * decoded.height * 4) throw new Error('Incomplete logo raster.');
    } else {
      await validatePngRaster(customerLogo);
    }
    return customerLogo;
  } catch {
    throw new Error('The packet logo could not be decoded. Replace it with a valid PNG or JPEG in Settings.');
  }
}

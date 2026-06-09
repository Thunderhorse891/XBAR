import { inflateRawSync } from 'node:zlib';

// Minimal ZIP reader for bulk intake uploads. Supports stored (0) and
// deflated (8) entries, which covers every mainstream ZIP producer. Encrypted
// or unsupported entries are skipped with a note.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const EXTENSION_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain',
  csv: 'text/csv',
};

export function guessMimeType(fileName) {
  const extension = String(fileName).split('.').pop()?.toLowerCase() || '';
  return EXTENSION_MIME[extension] || 'application/octet-stream';
}

export function isZipBuffer(buffer) {
  return buffer?.length > 4 && buffer.readUInt32LE(0) === LOCAL_SIGNATURE;
}

export function extractZipEntries(buffer, { maxEntries = 50 } = {}) {
  // Locate the end-of-central-directory record (search backwards, allowing a
  // trailing comment of up to 64KB).
  let eocdOffset = -1;
  const searchStart = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid ZIP archive: end of central directory not found.');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);

  const entries = [];
  const skipped = [];

  for (let index = 0; index < entryCount && entries.length < maxEntries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break;

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const flags = buffer.readUInt16LE(cursor + 8);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    cursor += 46 + nameLength + extraLength + commentLength;

    if (fileName.endsWith('/') || fileName.startsWith('__MACOSX/')) continue;

    if ((flags & 0x1) !== 0) {
      skipped.push({ fileName, reason: 'encrypted entry' });
      continue;
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      skipped.push({ fileName, reason: `unsupported compression method ${compressionMethod}` });
      continue;
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    try {
      const content = compressionMethod === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
      entries.push({
        fileName: fileName.split('/').pop() || fileName,
        mimeType: guessMimeType(fileName),
        content,
      });
    } catch (error) {
      skipped.push({ fileName, reason: `inflate failed: ${error.message}` });
    }
  }

  return { entries, skipped };
}

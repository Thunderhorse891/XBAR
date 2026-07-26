// Minimal PNG read/write, enough for the App Store icon pipeline.
//
// Apple rejects an app icon that carries an alpha channel, even a fully opaque
// one, so the 1024x1024 master has to be re-encoded as truecolour-without-alpha
// (PNG colour type 2). Nothing in the dependency tree can do that — sharp and
// friends are native modules this repo deliberately does not pull in — and the
// job is small: inflate, unfilter, composite, refilter, deflate.
//
// Supported subset: 8-bit, non-interlaced, colour type 2 (RGB) and 6 (RGBA).
// That covers every asset in public/brand/. Anything else throws rather than
// silently producing a wrong file.

import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32Table() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * @returns {{width: number, height: number, channels: number, data: Buffer}}
 *   `data` is raw, unfiltered samples, `channels` wide per pixel.
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }

  let offset = 8;
  let header = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  if (!header) throw new Error('PNG has no IHDR chunk');
  if (header.bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${header.bitDepth} (need 8)`);
  if (header.interlace !== 0) throw new Error('interlaced PNGs are not supported');
  if (header.colorType !== 2 && header.colorType !== 6) {
    throw new Error(`unsupported PNG colour type ${header.colorType} (need 2 or 6)`);
  }

  const channels = header.colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = header.width * channels;
  const out = Buffer.alloc(stride * header.height);

  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const outLine = out.subarray(y * stride, (y + 1) * stride);
    const prevLine = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? outLine[x - channels] : 0;
      const up = prevLine ? prevLine[x] : 0;
      const upLeft = prevLine && x >= channels ? prevLine[x - channels] : 0;
      const value = line[x];

      if (filter === 0) outLine[x] = value;
      else if (filter === 1) outLine[x] = (value + left) & 0xff;
      else if (filter === 2) outLine[x] = (value + up) & 0xff;
      else if (filter === 3) outLine[x] = (value + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) outLine[x] = (value + paethPredictor(left, up, upLeft)) & 0xff;
      else throw new Error(`unsupported PNG filter type ${filter}`);
    }
  }

  return { width: header.width, height: header.height, channels, data: out };
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typeAndBody = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndBody), 0);
  return Buffer.concat([length, typeAndBody, crc]);
}

/** Encode 3-channel RGB samples as a colour-type-2 PNG (no alpha channel). */
export function encodeRgbPng({ width, height, data }) {
  if (data.length !== width * height * 3) {
    throw new Error('RGB buffer size does not match the given dimensions');
  }

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const line = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    let bestFilter = 0;
    let bestScore = Infinity;
    let best = null;

    // Standard adaptive filtering: try each filter and keep the line whose
    // residuals have the smallest absolute sum, which is the heuristic the PNG
    // spec suggests for how well deflate will then compress it.
    for (let filter = 0; filter <= 4; filter += 1) {
      let score = 0;

      for (let x = 0; x < stride; x += 1) {
        const value = line[x];
        const left = x >= 3 ? line[x - 3] : 0;
        const up = prev ? prev[x] : 0;
        const upLeft = prev && x >= 3 ? prev[x - 3] : 0;
        let residual;

        if (filter === 0) residual = value;
        else if (filter === 1) residual = value - left;
        else if (filter === 2) residual = value - up;
        else if (filter === 3) residual = value - ((left + up) >> 1);
        else residual = value - paethPredictor(left, up, upLeft);

        residual &= 0xff;
        candidate[x] = residual;
        // Treat bytes as signed when scoring: 0xff is a residual of -1, i.e.
        // cheap, not expensive.
        score += residual < 128 ? residual : 256 - residual;
      }

      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        best = Buffer.from(candidate);
      }
    }

    raw[y * (stride + 1)] = bestFilter;
    best.copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour, no alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Composite an image over an opaque background and drop the alpha channel.
 * @param {{r:number,g:number,b:number}} background
 */
export function flattenOntoBackground(image, background) {
  const out = Buffer.alloc(image.width * image.height * 3);
  const pixels = image.width * image.height;

  for (let index = 0; index < pixels; index += 1) {
    const source = index * image.channels;
    const target = index * 3;
    const alpha = image.channels === 4 ? image.data[source + 3] / 255 : 1;

    out[target] = Math.round(image.data[source] * alpha + background.r * (1 - alpha));
    out[target + 1] = Math.round(image.data[source + 1] * alpha + background.g * (1 - alpha));
    out[target + 2] = Math.round(image.data[source + 2] * alpha + background.b * (1 - alpha));
  }

  return { width: image.width, height: image.height, data: out };
}

/**
 * Box-filter downscale of a flattened RGB image. Only ever used to shrink, so
 * every target pixel averages a whole source region — no aliasing.
 */
export function resizeRgb(image, width, height) {
  const out = Buffer.alloc(width * height * 3);
  const xRatio = image.width / width;
  const yRatio = image.height / height;

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yRatio));

    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xRatio));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;

      for (let sy = y0; sy < y1 && sy < image.height; sy += 1) {
        for (let sx = x0; sx < x1 && sx < image.width; sx += 1) {
          const source = (sy * image.width + sx) * 3;
          r += image.data[source];
          g += image.data[source + 1];
          b += image.data[source + 2];
          count += 1;
        }
      }

      const target = (y * width + x) * 3;
      out[target] = Math.round(r / count);
      out[target + 1] = Math.round(g / count);
      out[target + 2] = Math.round(b / count);
    }
  }

  return { width, height, data: out };
}

/** Does this PNG carry an alpha channel? Apple rejects app icons that do. */
export function hasAlphaChannel(buffer) {
  const { colorType } = decodePngHeader(buffer);
  return colorType === 4 || colorType === 6;
}

export function decodePngHeader(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

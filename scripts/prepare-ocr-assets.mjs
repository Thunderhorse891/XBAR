import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stage the OCR runtime (tesseract.js worker, WASM cores, English language
// data) into public/ocr so document OCR is served same-origin. Without this,
// tesseract.js loads all three from cdn.jsdelivr.net at runtime, which breaks
// OCR entirely for users behind firewalls/content blockers and whenever the
// CDN is unreachable — and never works offline. public/ocr is gitignored;
// this script runs automatically before dev and build.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'ocr');
const langDir = join(outDir, 'lang');

const copies = [
  ['node_modules/tesseract.js/dist/worker.min.js', join(outDir, 'worker.min.js')],
  // createWorker() defaults to LSTM-only recognition, so only the LSTM core
  // variants are ever requested. The worker picks one based on SIMD support.
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', join(outDir, 'tesseract-core-lstm.wasm.js')],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', join(outDir, 'tesseract-core-simd-lstm.wasm.js')],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', join(outDir, 'tesseract-core-relaxedsimd-lstm.wasm.js')],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', join(langDir, 'eng.traineddata.gz')],
];

mkdirSync(langDir, { recursive: true });

for (const [from, to] of copies) {
  const source = join(root, from);
  if (!existsSync(source)) {
    console.error(`prepare-ocr-assets: missing ${from} — run npm install first.`);
    process.exit(1);
  }
  copyFileSync(source, to);
}

console.log(`prepare-ocr-assets: staged ${copies.length} OCR runtime files into public/ocr`);

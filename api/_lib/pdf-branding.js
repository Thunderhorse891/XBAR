import { readFile } from 'node:fs/promises';
import path from 'node:path';

let pending;

/** Fixed, bundled XBAR artwork; never fetch a customer-supplied address. */
export function loadServerPdfBranding() {
  pending ??= Promise.all([
    readFile(path.join(process.cwd(), 'public/brand/xbar-report-horse.png')),
    readFile(path.join(process.cwd(), 'public/brand/xbar-original-lockup-480.png')),
    readFile(path.join(process.cwd(), 'public/brand/xbar-report-watermark.png')),
  ])
    .then(([logo, mark, watermark]) => ({ logo, mark, watermark }))
    .catch((error) => {
      pending = undefined;
      throw error;
    });
  return pending;
}

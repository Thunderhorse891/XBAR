// Capture real product screenshots for the public /demo and homepage.
//
// Drives the actual built application (dist/, served with production-parity
// routing) through the real local-first workflow — workspace setup, adding a
// horse through the global Create flow — and screenshots what the product
// genuinely renders. No mockups: if the UI changes, re-run this script.
//
// Usage: npm run build && node scripts/capture-product-screenshots.mjs
// Env:   XBAR_CHROME=/path/to/chromium  (falls back to Playwright's bundled browser)

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const outDir = path.join(repoRoot, 'public', 'brand', 'screenshots');
mkdirSync(outDir, { recursive: true });

const PORT = 4181;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('node', [path.join(here, 'serve-dist.mjs'), '--port', String(PORT)], {
  stdio: 'inherit',
});
await sleep(1200);

const browser = await chromium.launch(process.env.XBAR_CHROME ? { executablePath: process.env.XBAR_CHROME } : {});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const shot = async (name) => {
    await page.waitForTimeout(700);
    // JPEG keeps these full-page captures web-weight (PNGs run 0.4–1.3 MB).
    await page.screenshot({ path: path.join(outDir, `${name}.jpg`), type: 'jpeg', quality: 88 });
    console.log(`[screenshots] captured ${name}.jpg`);
  };

  // 1 — sign-in screen (fresh visitor state).
  await page.goto(`${BASE}/app/login`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Sign In' }).waitFor({ timeout: 20_000 });
  await shot('app-login');

  // 2 — real local-first workspace setup.
  await page.evaluate(() => globalThis.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto(`${BASE}/app/setup`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Configure Workspace' }).waitFor({ timeout: 20_000 });
  await page.getByPlaceholder('XBAR LLC').fill('Example Ranch LLC');
  await page.getByPlaceholder('Primary Ranch').fill('Example Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Demo Manager');
  await page.getByPlaceholder('ops@xbar.com').fill('demo@example.com');
  await page.getByPlaceholder('Legal owner').fill('Example Ranch LLC');
  await page.getByPlaceholder('Owner entity').fill('Example Ranch LLC');
  await page.getByPlaceholder('Barn A').fill('Main Barn');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await shot('app-workspace-setup');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL(/\/app$/, { timeout: 20_000 });

  // 3 — add a horse through the real global Create flow.
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('Example Doc Bar');
  await shot('app-quick-create-horse');
  await drawer.getByRole('button', { name: 'Add Horse' }).click();
  await page.waitForURL(/\/app\/horses\//, { timeout: 20_000 });

  // 4 — the horse record itself (wait out the success toast so the frame is clean).
  await page.waitForTimeout(5_000);
  await shot('app-horse-record');

  // 5 — dashboard with real workspace state.
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await shot('app-dashboard');

  // 6 — documents pipeline.
  await page.goto(`${BASE}/app/documents`, { waitUntil: 'networkidle' });
  await shot('app-documents');

  await context.close();
  console.log(`[screenshots] done -> ${outDir}`);
} finally {
  await browser.close();
  server.kill();
}

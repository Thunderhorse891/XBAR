#!/usr/bin/env node
// Capture App Store Connect screenshots at Apple's required pixel sizes.
//
//   npm run build:local && node scripts/capture-app-store-screenshots.mjs
// Env:
//   XBAR_CHROME=/path/to/chromium   use a specific browser binary
//   XBAR_DEVICES=iphone-6-9,ipad-13 capture only these device classes
//   XBAR_CHROME_NO_SANDBOX=1        pass --no-sandbox (needed in containers
//                                   that run as root; leave off locally)
//
// Like scripts/capture-product-screenshots.mjs, this drives the real built
// application through the real workflow — nothing here is a mockup. The
// difference is the viewport: each context is sized so the resulting PNG has
// exactly the pixel dimensions App Store Connect accepts for that device
// class, which means these files can be uploaded without any editing step.
//
// Apple's current rule: 6.9" iPhone screenshots are required, and 13" iPad
// screenshots are required if the app supports iPad. 6.5" is kept because
// older listings still display it and it costs one more pass.

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const outRoot = path.join(repoRoot, 'ios-submission', 'screenshots');

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * viewport x deviceScaleFactor must equal Apple's required pixel size exactly.
 * @type {{id: string, label: string, viewport: {width: number, height: number}, scale: number, pixels: string}[]}
 */
const DEVICES = [
  {
    id: 'iphone-6-9',
    label: '6.9" iPhone (16 Pro Max) — required',
    viewport: { width: 430, height: 932 },
    scale: 3,
    pixels: '1290x2796',
  },
  {
    id: 'iphone-6-5',
    label: '6.5" iPhone (11 Pro Max) — optional',
    viewport: { width: 414, height: 896 },
    scale: 3,
    pixels: '1242x2688',
  },
  {
    id: 'ipad-13',
    label: '13" iPad Pro — required if the app ships for iPad',
    viewport: { width: 1024, height: 1366 },
    scale: 2,
    pixels: '2048x2732',
  },
];

const selected = process.env.XBAR_DEVICES
  ? DEVICES.filter((device) => process.env.XBAR_DEVICES.split(',').includes(device.id))
  : DEVICES;

if (!selected.length) {
  throw new Error(`XBAR_DEVICES matched nothing. Known ids: ${DEVICES.map((d) => d.id).join(', ')}`);
}

const server = spawn('node', [path.join(here, 'serve-dist.mjs'), '--port', String(PORT)], { stdio: 'inherit' });
await sleep(1200);

const browser = await chromium.launch({
  ...(process.env.XBAR_CHROME ? { executablePath: process.env.XBAR_CHROME } : {}),
  ...(process.env.XBAR_CHROME_NO_SANDBOX ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}),
});

/** Walk a fresh workspace through setup so the captures show real state. */
async function seedWorkspace(page) {
  await page.goto(`${BASE}/app/login`, { waitUntil: 'networkidle' });
  await page.evaluate(() => globalThis.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto(`${BASE}/app/setup`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Configure Workspace' }).waitFor({ timeout: 20_000 });
  await page.getByPlaceholder('XBAR LLC').fill('Cross Timbers Ranch LLC');
  await page.getByPlaceholder('Primary Ranch').fill('Cross Timbers Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Dana Reyes');
  await page.getByPlaceholder('ops@xbar.com').fill('ops@crosstimbers.example');
  await page.getByPlaceholder('Legal owner').fill('Cross Timbers Ranch LLC');
  await page.getByPlaceholder('Owner entity').fill('Cross Timbers Ranch LLC');
  await page.getByPlaceholder('Barn A').fill('Main Barn');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL(/\/app$/, { timeout: 20_000 });

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('CT Copper Canyon');
  await drawer.getByRole('button', { name: 'Add Horse' }).click();
  await page.waitForURL(/\/app\/horses\//, { timeout: 20_000 });
  // Let the success toast expire so it is not baked into every frame.
  await page.waitForTimeout(5_000);
}

try {
  for (const device of selected) {
    const outDir = path.join(outRoot, device.id);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    const context = await browser.newContext({
      viewport: device.viewport,
      deviceScaleFactor: device.scale,
      isMobile: device.id.startsWith('iphone'),
      hasTouch: true,
    });
    const page = await context.newPage();

    // Present the page with the same Capacitor global the real binary injects,
    // so what gets captured is the iOS build's UI — native shell chrome, and
    // the read-only billing screen required by Guideline 3.1.1 — rather than
    // the web build at a phone-sized viewport. Must run before the bundle
    // evaluates, which is what addInitScript guarantees.
    await page.addInitScript(() => {
      Object.defineProperty(globalThis, 'Capacitor', {
        value: { isNativePlatform: () => true, getPlatform: () => 'ios' },
        configurable: true,
      });
    });

    let index = 0;
    const shot = async (name) => {
      index += 1;
      await page.waitForTimeout(700);
      // Not fullPage: App Store Connect requires the exact device pixel size,
      // and a full-page capture would be taller than the screen.
      await page.screenshot({ path: path.join(outDir, `${String(index).padStart(2, '0')}-${name}.png`) });
      console.log(`[app-store-shots] ${device.id} ${device.pixels} -> ${index}-${name}.png`);
    };

    await seedWorkspace(page);

    await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
    await shot('dashboard');

    await page.goto(`${BASE}/app/horses`, { waitUntil: 'networkidle' });
    await shot('horses');

    await page.goto(`${BASE}/app/documents`, { waitUntil: 'networkidle' });
    await shot('documents');

    await page.goto(`${BASE}/app/today`, { waitUntil: 'networkidle' });
    await shot('care-tasks');

    await page.goto(`${BASE}/app/reports`, { waitUntil: 'networkidle' });
    await shot('reports');

    await context.close();
  }

  console.log(`[app-store-shots] done -> ${path.relative(repoRoot, outRoot)}`);
} finally {
  await browser.close();
  server.kill();
}

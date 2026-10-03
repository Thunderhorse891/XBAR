import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Locator } from '@playwright/test';

const origin = 'https://xbar-brand-fixture.github.io';
const base = '/XBAR/';
const dist = path.resolve('dist');

async function expectArtwork(image: Locator, name: string) {
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', `${base}brand/${name}`);
  const png = await readFile(path.join(dist, 'brand', name));
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => ({
        loaded: element.complete,
        width: element.naturalWidth,
        height: element.naturalHeight,
      })),
    )
    .toEqual({ loaded: true, width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
}

test('built GitHub Pages entry and shell images load inside /XBAR/', async ({ context, page }) => {
  // Refuse to accidentally exercise a root/Vercel build left by another suite.
  expect(await readFile(path.join(dist, 'index.html'), 'utf8')).toContain('/XBAR/assets/');
  const rootBrandRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // The synthetic .github.io host exercises the shipped hash-router/preview
  // branch without overriding auth flags. No request reaches an actual site,
  // API, or account. In particular, /brand/* is a 404, never a root alias.
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/brand/')) rootBrandRequests.push(url.pathname);
    if (request.method() !== 'GET' || !url.pathname.startsWith(base)) {
      return route.fulfill({ status: 404, body: 'Not found' });
    }
    const relative = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
    const file = path.resolve(dist, relative);
    if (!file.startsWith(`${dist}${path.sep}`)) return route.fulfill({ status: 404, body: 'Not found' });
    const exists = await stat(file).catch(() => null);
    if (!exists?.isFile()) return route.fulfill({ status: 404, body: 'Not found' });
    return route.fulfill({ path: file });
  });

  await page.goto(`${origin}${base}#/login`);
  await expect(page.getByRole('heading', { name: 'Sign In', exact: true })).toBeVisible();
  await expectArtwork(page.locator('.clean-brand__wordmark'), 'xbar-wordmark.png');
  await expectArtwork(page.locator('.clean-login-visual__art'), 'xbar-report-horse.png');

  await page.goto(`${origin}${base}#/reset-password`);
  await expect(page.getByRole('heading', { name: 'New Password', exact: true })).toBeVisible();
  await expectArtwork(page.locator('.clean-brand__wordmark'), 'xbar-wordmark.png');

  // Existing local-preview entry gate, also used by the root smoke suite.
  await page.evaluate(() => localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto(`${origin}${base}#/setup`);
  await expect(page.getByRole('heading', { name: 'Configure Workspace', exact: true })).toBeVisible();
  await expectArtwork(page.locator('.clean-brand__wordmark'), 'xbar-wordmark.png');
  await expectArtwork(page.locator('.clean-setup-art'), 'xbar-report-horse.png');

  // Create only a browser-local fixture workspace to reach Dashboard. Every
  // network request is still isolated above; no account or billing is touched.
  await page.getByLabel('Business name').fill('Artwork Fixture Ranch');
  await page.getByLabel('Ranch name').fill('Artwork Fixture Ranch');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expectArtwork(page.locator('.xs-hero__wm'), 'icon-512.png');
  await expectArtwork(page.locator('.xs-sidebar .xs-brand__wordmark'), 'xbar-wordmark.png');
  await page.goto(`${origin}${base}#/reminders`);
  await expect(page.getByRole('heading', { name: 'Reminders', exact: true })).toBeVisible();
  await expectArtwork(page.locator('.reminders-header__art'), 'xbar-report-horse.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectArtwork(page.locator('.xs-mobile-brand img'), 'apple-touch-icon.png');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expectArtwork(page.locator('.xs-navigation-sheet .xs-brand__wordmark'), 'xbar-wordmark.png');

  expect(rootBrandRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

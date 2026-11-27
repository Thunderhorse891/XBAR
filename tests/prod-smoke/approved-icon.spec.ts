import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

const base = '/brand/icons/original-blue-20261127-v2';
for (const width of [390, 1440])
  test(`approved icon bytes and public/app heads at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const entry of ['/', '/pricing', '/app/login?mode=signup']) {
      await page.goto(entry);
      await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveAttribute('href', `${base}/icon-180.png`);
      await expect(page.locator('head link[rel="icon"][sizes="32x32"]')).toHaveAttribute('href', `${base}/icon-32.png`);
      await expect(page.locator('head link[rel="icon"][sizes="16x16"]')).toHaveAttribute('href', `${base}/icon-16.png`);
    }
    const manifest = await (await page.request.get('/site.webmanifest')).json();
    expect(manifest.start_url).toBe('/app');
    expect(manifest.id).toBe('/app');
    expect(manifest.scope).toBe('/');
    for (const name of [
      'icon-16.png',
      'icon-32.png',
      'icon-180.png',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
    ]) {
      const response = await page.request.get(`${base}/${name}`);
      expect(response.status()).toBe(200);
      const bytes = await response.body();
      const size = name.includes('maskable') ? 512 : Number(name.match(/\d+/)![0]);
      expect(bytes.readUInt32BE(16)).toBe(size);
      expect(bytes.readUInt32BE(20)).toBe(size);
      expect(bytes[25]).toBe(2);
    }
    const master = await page.request.get(`${base}/icon-1024.png`);
    expect(master.status()).toBe(200);
    expect(
      createHash('sha256')
        .update(await master.body())
        .digest('hex'),
    ).toBe('43b7b697184aaa4906f39df66698f2154b8a60b6606320557d1d011018334e98');
  });

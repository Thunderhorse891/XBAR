import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const base = '/brand/icons/original-blue-20261127-v2';
for (const width of [390, 1440])
  test(`approved icon bytes and public/app heads at ${width}px`, async ({ page }, testInfo) => {
    const provenance = JSON.parse(readFileSync(`public${base}/source.json`, 'utf8'));
    const results: unknown[] = [];
    const headers = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
    await page.setViewportSize({ width, height: 844 });
    for (const entry of ['/', '/app/login', '/pricing', '/app/login?mode=signup']) {
      await page.goto(entry);
      const response = await page.request.get(entry, { headers });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/html');
      results.push({ path: entry, status: response.status(), contentType: response.headers()['content-type'] });
      await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveAttribute('href', `${base}/icon-180.png`);
      await expect(page.locator('head link[rel="icon"][sizes="32x32"]')).toHaveAttribute('href', `${base}/icon-32.png`);
      await expect(page.locator('head link[rel="icon"][sizes="16x16"]')).toHaveAttribute('href', `${base}/icon-16.png`);
    }
    const manifestResponse = await page.request.get('/site.webmanifest', { headers });
    expect(manifestResponse.status()).toBe(200);
    const manifest = await manifestResponse.json();
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
      const response = await page.request.get(`${base}/${name}`, { headers });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
      const bytes = await response.body();
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      expect(sha256).toBe(provenance.files.find((file: { file: string }) => file.file === name).sha256);
      const size = name.includes('maskable') ? 512 : Number(name.match(/\d+/)![0]);
      expect(bytes.readUInt32BE(16)).toBe(size);
      expect(bytes.readUInt32BE(20)).toBe(size);
      expect(bytes[25]).toBe(2);
      results.push({
        path: `${base}/${name}`,
        status: response.status(),
        contentType: response.headers()['content-type'],
        sha256,
        width: size,
        height: size,
      });
    }
    const master = await page.request.get(`${base}/icon-1024.png`);
    expect(master.status()).toBe(200);
    expect(
      createHash('sha256')
        .update(await master.body())
        .digest('hex'),
    ).toBe('43b7b697184aaa4906f39df66698f2154b8a60b6606320557d1d011018334e98');
    await writeFile(
      testInfo.outputPath('icon-http-readback.json'),
      JSON.stringify(
        {
          scope: 'LOCAL BUILT BROWSER REGRESSION, NOT LIVE PRODUCTION',
          timestamp: new Date().toISOString(),
          width,
          installIdentity: { start_url: manifest.start_url, id: manifest.id, scope: manifest.scope },
          results,
        },
        null,
        2,
      ),
    );
  });

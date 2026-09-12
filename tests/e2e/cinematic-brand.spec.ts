import { expect, test } from '@playwright/test';

test('cinematic brand concept plays, pauses and switches views without mobile overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/brand/cinematic-preview/index.html');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  await page.getByRole('tab', { name: 'Sale preparation' }).click();
  await expect(page.locator('#value-c')).toHaveText('Blocked');
  await page.getByRole('tab', { name: 'Sale preparation' }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Records', exact: true })).toBeFocused();
  await expect(page.locator('#detail-title')).toHaveText('From a document to a useful record.');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`cinematic-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('cinematic brand concept respects reduced motion', async ({ page }) => {
  const videoRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp4')) videoRequests.push(request.url());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/brand/cinematic-preview/index.html');
  await expect(page.getByRole('button', { name: 'Play motion' })).toBeVisible();
  expect(await page.locator('video').evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  expect(await page.locator('.pulse').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  await expect(page.locator('video source')).not.toHaveAttribute('src');
  expect(videoRequests).toEqual([]);
});

test('cinematic brand concept saves data until playback is requested', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '2g' } }),
  );
  await page.goto('/brand/cinematic-preview/index.html');
  await expect(page.getByRole('button', { name: 'Play motion' })).toBeVisible();
  await expect(page.locator('video source')).not.toHaveAttribute('src');
  await expect(page.getByRole('heading', { name: 'Your ranch. In focus.' })).toBeVisible();
  await page.getByRole('button', { name: 'Play motion' }).click();
  await expect
    .poll(() => page.locator('video').evaluate((node: HTMLVideoElement) => node.currentTime))
    .toBeGreaterThan(0);
});

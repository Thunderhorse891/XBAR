import { expect, test, type Page } from '@playwright/test';

const state = (page: Page) => page.locator('#film').evaluate((node) => node.getAnimations()[0]?.playState ?? 'idle');
const playing = async (page: Page) => expect.poll(() => state(page)).toBe('running');

test('cinematic brand concept uses original artwork and works on desktop and mobile', async ({ page }) => {
  const errors: string[] = [],
    media: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/\.(mp4|webm)(\?|$)/.test(request.url())) media.push(request.url());
  });
  await page.goto('/brand/cinematic-preview/index.html');
  await playing(page);
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect.poll(() => state(page)).toBe('paused');
  await expect(page.locator('#film')).toHaveAttribute('src', '../xbar-report-horse.png');
  await expect(page.getByText(/Meta AI/i)).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Sale preparation' }).click();
  await expect(page.locator('#value-c')).toHaveText('Blocked');
  await page.getByRole('tab', { name: 'Sale preparation' }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Records', exact: true })).toBeFocused();
  // Review the settled artwork, not an arbitrary point in the reveal.
  await page.locator('#film').evaluate((node) => node.getAnimations()[0].finish());
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`cinematic-${width}.png`), fullPage: true });
  }
  expect(media).toEqual([]);
  expect(errors).toEqual([]);
});

test('cinematic brand concept starts static for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/brand/cinematic-preview/index.html');
  await expect(page.getByRole('button', { name: 'Play motion' })).toBeVisible();
  expect(await state(page)).toBe('idle');
  expect(await page.locator('#film').evaluate((node) => getComputedStyle(node).opacity)).toBe('0.82');
  expect(await page.locator('.pulse').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
});

test('cinematic brand concept stays static on data saving until requested', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '2g' } }),
  );
  await page.goto('/brand/cinematic-preview/index.html');
  expect(await state(page)).toBe('idle');
  await page.getByRole('button', { name: 'Play motion' }).click();
  await playing(page);
});

test('cinematic brand concept settles once and replays on request', async ({ page }) => {
  await page.goto('/brand/cinematic-preview/index.html');
  await playing(page);
  expect(await page.locator('#film').evaluate((node) => node.getAnimations()[0].effect?.getTiming().iterations)).toBe(
    1,
  );
  await page.locator('#film').evaluate((node) => {
    node.getAnimations()[0].currentTime = 4100;
  });
  await expect(page.getByRole('button', { name: 'Replay motion' })).toBeVisible();
  await page.getByRole('button', { name: 'Replay motion' }).click();
  await playing(page);
  expect(await page.locator('#film').evaluate((node) => Number(node.getAnimations()[0].currentTime))).toBeLessThan(
    2000,
  );
});

test('cinematic brand concept preserves manual pause and honors newly reduced motion', async ({ page }) => {
  await page.goto('/brand/cinematic-preview/index.html');
  await playing(page);
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => state(page)).toBe('paused');
  await page.getByRole('button', { name: 'Play motion' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => state(page)).toBe('paused');
  await page.getByRole('button', { name: 'Play motion' }).click();
  await playing(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByRole('button', { name: 'Pause motion' })).toBeVisible();
});

test('sign-in brand entrance is shared with the app and respects reduced motion', async ({ page }) => {
  await page.goto('/app/login');
  const brand = page.getByRole('complementary', { name: 'XBAR brand' });
  await expect(brand).toBeVisible();
  expect(await brand.evaluate((node) => getComputedStyle(node).animationName)).toBe('xbar-brand-in');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => brand.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  await page.screenshot({ path: test.info().outputPath('sign-in-brand.png'), fullPage: true });
});

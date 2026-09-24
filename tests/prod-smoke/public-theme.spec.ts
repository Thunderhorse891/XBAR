import { expect, test } from '@playwright/test';

// Also run the same assertions against the exact Vercel preview.
test.use({ baseURL: process.env.XBAR_PUBLIC_URL || 'http://127.0.0.1:4175', reducedMotion: 'reduce' });

const paper = 'rgb(245, 242, 236)';
const ink = 'rgb(11, 13, 15)';
const routes = [
  '/features',
  '/pricing',
  '/solutions',
  '/solutions/breeding-programs',
  '/solutions/sale-barns',
  '/solutions/trainers',
  '/solutions/ranch-operations',
  '/resources',
  '/resources/horse-records-checklist',
  '/resources/sale-ready-horse-documentation',
  '/resources/equine-ownership-transfer-checklist',
  '/demo',
  '/privacy',
  '/terms',
  '/404',
];

test('navigation from the approved homepage keeps the light theme', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('body')).toHaveCSS('background-color', paper);
  await page.locator('.site-nav .nav-dd').first().locator('summary').hover();
  await page.getByRole('link', { name: 'Solutions overview' }).click();
  await expect(page).toHaveURL(/\/solutions$/);
  await expect(page.locator('body')).toHaveCSS('background-color', paper);
  await expect(page.locator('h1')).toHaveCSS('color', ink);
  await page.locator('.site-nav').getByRole('link', { name: 'Pricing', exact: true }).click();
  await expect(page.locator('.plan__price').first()).toHaveCSS('color', ink);
  await expect(page.locator('body')).toHaveCSS('background-color', paper);
});

for (const width of [1440, 360]) {
  test(`public pages remain readable at ${width}px with a dark OS preference`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    for (const path of routes) {
      await page.goto(path);
      await expect(page.locator('h1'), path).toBeVisible();
      await expect(page.locator('body'), path).toHaveCSS('background-color', paper);
      await expect(page.locator('h1'), path).toHaveCSS('color', ink);
      await expect(page.locator('.bg-fx'), path).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path).toBe(true);
      await page.locator('.site-footer').scrollIntoViewIfNeeded();
      await expect(page.locator('.site-footer')).toHaveCSS('background-color', paper);
      await expect(page.locator('.site-header')).toHaveCSS('background-color', paper);
      if (await page.locator('.cta').count()) {
        await expect(page.locator('.cta .wrap')).toHaveCSS('background-image', 'none');
        await expect(page.locator('.cta .btn--primary').first()).toHaveCSS('color', paper);
      }
    }
  });
}

test('public mobile navigation and signup work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 360, height: 640 },
    baseURL: process.env.XBAR_PUBLIC_URL || 'http://127.0.0.1:4175',
  });
  const page = await context.newPage();
  try {
    await page.goto('/solutions');
    await page.locator('.public-mobile-nav > summary').click();
    await page.getByRole('navigation', { name: 'Mobile primary' }).getByRole('link', { name: 'Pricing' }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator('body')).toHaveCSS('background-color', paper);
    await page.locator('.public-mobile-nav > summary').click();
    await page
      .getByRole('navigation', { name: 'Mobile primary' })
      .getByRole('link', { name: 'Create your workspace' })
      .click();
    await expect(page).toHaveURL(/\/app\/login\?mode=signup$/);
  } finally {
    await context.close();
  }
});

test('light surfaces have fallbacks and a short-screen menu can reach signup', async ({ page }) => {
  await page.route('**/public-light.css', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text())
        .replace(/[^{};]+:[^{};]*color-mix\([^;]+;/g, '')
        .replace(/max-height:[^;]*dvh[^;]*;/g, ''),
    });
  });
  await page.setViewportSize({ width: 740, height: 320 });
  await page.goto('/solutions');
  await expect(page.locator('body')).toHaveCSS('background-color', paper);
  await page.locator('.public-mobile-nav > summary').click();
  const menu = page.getByRole('navigation', { name: 'Mobile primary' });
  const bounds = await menu.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(320);
  await menu.getByRole('link', { name: 'Create your workspace' }).click();
  await expect(page).toHaveURL(/\/app\/login\?mode=signup$/);
});

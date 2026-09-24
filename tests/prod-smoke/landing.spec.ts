import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const headline = 'Every horse. One clear picture.';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/metrics', (route) => route.fulfill({ status: 204 }));
});

test('homepage stays complete when its motion bundle cannot load', async ({ page }) => {
  await page.route('**/landing/*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: headline })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause motion' })).toBeHidden();
  await page.getByRole('link', { name: 'Open a sample packet' }).click();
  await expect(page).toHaveURL(/\/samples\/sample-sale-packet\.html$/);
});

test('no JavaScript still provides the full homepage and working signup', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: headline })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bring the papers' })).toBeVisible();
  await page.getByRole('link', { name: 'Create your workspace', exact: true }).first().click();
  await expect(page).toHaveURL(/\/app\/login\?mode=signup$/);
  await context.close();
});

test('reduced motion and pause leave every section visible and stop animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reduced motion on' })).toBeDisabled();
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-landing-motion', 'off');
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  const states = await page
    .locator('[data-hero-reveal], [data-landing-reveal]')
    .evaluateAll((elements) =>
      elements.map((el) => ({ opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform })),
    );
  expect(states.filter((s) => s.opacity !== '1' || s.transform !== 'none')).toEqual([]);
  await expect(page.locator('[data-landing-count]')).toHaveText('5');
});

test('mobile has no horizontal overflow and app routes load no landing code', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const landingRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/landing/')) landingRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: headline })).toBeVisible();
  await expect(page.locator('.landing-motion-toggle')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(landingRequests.length).toBeGreaterThan(0);
  landingRequests.length = 0;
  await page.goto('/pricing');
  await expect(page.locator('body')).not.toHaveClass(/landing-page/);
  expect(landingRequests).toEqual([]);
  await page.goto('/app/login');
  await expect(page.getByRole('heading', { name: 'Sign In', exact: true })).toBeVisible();
  expect(landingRequests).toEqual([]);
});

test('homepage motion executes under the production content security policy', async ({ page }) => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const csp = config.headers[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy').value;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'Content-Security-Policy': csp.replace('upgrade-insecure-requests', '') },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pause motion' })).toBeVisible();
  await page.getByRole('link', { name: 'Explore XBAR' }).click();
  await expect(page).toHaveURL(/#inside-xbar$/);
  await expect(page.getByRole('heading', { name: 'The whole story. Right where you need it.' })).toBeVisible();
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const headline = 'Every horse. One clear picture.';

test('light navigation remains readable when CSS color mixing is unsupported', async ({ page }) => {
  // Emulate discarded unsupported declarations in the served stylesheet,
  // preserving earlier fallback declarations as an older CSS parser would.
  await page.route('**/landing.css', async (route) => {
    const response = await route.fetch();
    const css = (await response.text()).replace(/[\w-]+\s*:\s*[^;{}]*color-mix\([^;{}]*;/g, '');
    await route.fulfill({ response, body: css });
  });
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const colors = await page.locator('.site-header').evaluate((header) => ({
      background: getComputedStyle(header).backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
    }));
    expect(colors.background).toBe(colors.page);
    expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
    if (width === 360) {
      await page.locator('.landing-mobile-nav > summary').click();
      await expect(
        page.locator('.landing-mobile-nav').getByRole('link', { name: 'Create your workspace' }),
      ).toBeVisible();
    }
  }
});

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

test('plan hover remains available after its entrance animation finishes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pause motion' })).toBeVisible();
  const plan = page.locator('.landing-plan').first();
  await plan.scrollIntoViewIfNeeded();
  await expect.poll(() => plan.evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0);
  await expect.poll(() => plan.evaluate((el) => el.getAnimations().length)).toBe(0);
  const resting = await plan.boundingBox();
  expect(resting).not.toBeNull();
  await plan.hover();
  await expect.poll(async () => (await plan.boundingBox())!.y).toBeLessThan(resting!.y);
});

test('pause and play do not fade previously read content again', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pause motion' })).toBeVisible();
  const heading = page.locator('.landing-section-heading').first();
  await heading.scrollIntoViewIfNeeded();
  await expect.poll(() => heading.evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0);
  await expect.poll(() => heading.evaluate((el) => el.getAnimations().length)).toBe(0);
  const opacitySamples = await heading.evaluate(async (el) => {
    // Trigger the real toggle handlers without scrolling back to the hero;
    // Playwright's auto-scroll/stability wait otherwise hides the replay.
    const toggle = document.querySelector<HTMLButtonElement>('.landing-motion-toggle')!;
    toggle.click();
    toggle.click();
    const samples: string[] = [];
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        samples.push(getComputedStyle(el).opacity);
        if (performance.now() - started < 250) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    return samples;
  });
  expect(opacitySamples.every((opacity) => opacity === '1')).toBe(true);
});

test('phone navigation exposes sign-in and signup without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
    baseURL,
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('.landing-mobile-nav > summary').click();
  const nav = page.getByRole('navigation', { name: 'Mobile primary', exact: true });
  await expect(nav.getByRole('link', { name: 'Create your workspace' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Pricing', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/login$/);
  await context.close();
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

test('legacy media-query listeners can initialize and react to reduced motion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const original = matchMedia(query);
      return {
        get matches() {
          return original.matches;
        },
        media: original.media,
        onchange: null,
        addListener: original.addListener.bind(original),
        removeListener: original.removeListener.bind(original),
        dispatchEvent: original.dispatchEvent.bind(original),
      } as MediaQueryList;
    };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pause motion' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Reduced motion on' })).toBeDisabled();
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  expect(errors).toEqual([]);
});

test('a browser without native animation support keeps the complete static page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'animate', { value: undefined });
  });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-landing-motion', 'off');
  await expect(page.getByRole('heading', { name: headline })).toBeVisible();
  await expect(page.locator('.landing-motion-toggle')).toBeHidden();
  await page.getByRole('link', { name: 'Open a sample packet' }).click();
  await expect(page).toHaveURL(/\/samples\/sample-sale-packet\.html$/);
  expect(errors).toEqual([]);
});

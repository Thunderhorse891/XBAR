import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Use the same inventory as build-marketing so a new public marketing route
// cannot silently escape the shared-shell checks. Legal/404 are built separately.
const { marketingPages, notFoundPage } = (await import(
  pathToFileURL(path.join(process.cwd(), 'scripts/marketing/pages.mjs')).href
)) as { marketingPages: { path: string }[]; notFoundPage: { path: string } };
const publicPaths = [...marketingPages.map((page) => page.path), '/terms', '/privacy', notFoundPage.path];
const mobileDestinations = [
  '/features',
  '/pricing',
  'mailto:xbarje@gmail.com',
  '/solutions',
  '/resources',
  '/demo',
  '/app/login',
  '/app/login?mode=signup',
];

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectStaticContent(page: Page) {
  const unreadable = await page.locator('main h1, main h2, main h3, main p, main li').evaluateAll((elements) =>
    elements
      .filter((element) => element.textContent?.trim())
      .filter((element) => {
        for (
          let current: Element | null = element;
          current && current !== document.body;
          current = current.parentElement
        ) {
          const style = getComputedStyle(current);
          if (style.opacity !== '1' || style.visibility === 'hidden' || style.display === 'none') return true;
        }
        return false;
      })
      .map((element) => element.textContent?.trim()),
  );
  expect(unreadable).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/metrics', (route) => route.fulfill({ status: 204 }));
});

for (const pathname of publicPaths) {
  test(`${pathname} shares the public brand on desktop and phone`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    const requests: string[] = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    await page.goto(pathname);
    await expect(page.locator('body')).toHaveClass(/\bmarketing-page\b/);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('.site-header .site-nav')).toBeVisible();
    await expect(page.locator('.landing-mobile-nav')).toBeHidden();
    await expectNoHorizontalOverflow(page);

    const identity = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const heading = getComputedStyle(document.querySelector('main h1')!);
      const button = getComputedStyle(document.querySelector('.site-header .btn--primary')!);
      return {
        background: body.backgroundColor,
        ink: body.color,
        bodyFont: body.fontFamily,
        headingFont: heading.fontFamily,
        buttonBackground: button.backgroundColor,
        buttonInk: button.color,
      };
    });
    expect(identity.background).toBe('rgb(255, 255, 255)');
    expect(identity.ink).toBe('rgb(11, 13, 15)');
    expect(identity.bodyFont).toContain('Outfit');
    expect(identity.headingFont).toBe(identity.bodyFont);
    expect(identity.buttonBackground).toBe('rgb(32, 45, 60)');
    expect(identity.buttonInk).toBe(identity.background);
    expect(requests).toContain('/brand/xbar-brand-tokens.css');
    expect(requests).toContain('/site.css');
    if (pathname !== '/') {
      expect(requests.filter((url) => url === '/landing.css' || url.startsWith('/landing/'))).toEqual([]);
      await expect(page.locator('body')).not.toHaveClass(/\blanding-page\b/);
    }

    // The narrower viewport also catches long article titles, legal headings,
    // pricing comparisons, and nav labels that desktop checks cannot expose.
    await page.setViewportSize({ width: 320, height: 740 });
    await expect(page.locator('.site-header .site-nav')).toBeHidden();
    await expect(page.locator('.landing-mobile-nav > summary')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.locator('.landing-mobile-nav > summary').click();
    const menu = page.getByRole('navigation', { name: 'Mobile primary', exact: true });
    await expect(menu).toBeVisible();
    expect(await menu.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual(
      mobileDestinations,
    );
    const signup = menu.getByRole('link', { name: 'Create your workspace', exact: true });
    await signup.scrollIntoViewIfNeeded();
    await expect(signup).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await signup.focus();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    const summary = page.locator('.landing-mobile-nav > summary');
    await expect(summary).toBeFocused();
    await summary.press('Enter');
    await expect(menu).toBeVisible();
    // A pointer click outside the menu closes it without intercepting normal
    // native details keyboard interactions. Do not navigate away from the page.
    const currentURL = page.url();
    await page.mouse.click(1, 100);
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(currentURL);
  });

  test(`${pathname} keeps content and native navigation without JavaScript`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
      baseURL,
    });
    try {
      const page = await context.newPage();
      await page.goto(pathname);
      await expect(page.locator('main h1')).toBeVisible();
      await expectStaticContent(page);
      await expectNoHorizontalOverflow(page);
      await page.locator('.landing-mobile-nav > summary').click();
      const menu = page.getByRole('navigation', { name: 'Mobile primary', exact: true });
      await expect(menu.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Help & support', exact: true })).toHaveAttribute(
        'href',
        'mailto:xbarje@gmail.com',
      );
      await menu.getByRole('link', { name: 'Pricing', exact: true }).click();
      await expect(page).toHaveURL(/\/pricing$/);
      await expect(
        page.getByRole('heading', { name: 'Simple plans. Published limits. No hidden capacity math.' }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test('public pages reveal all content when reduced motion is enabled after loading', async ({ page }) => {
  for (const pathname of ['/features', '/pricing', '/resources/horse-records-checklist', '/terms']) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(pathname);
    await expect(page.locator('html')).toHaveClass(/\bjs\b/);
    // Change the live preference after progressive enhancement has had a chance
    // to mark below-fold content. Testing reduced motion only at load misses this.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect
      .poll(() =>
        page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length),
      )
      .toBe(0);
    await expectStaticContent(page);
  }
});

test('short-screen public navigation keeps signup reachable without dynamic viewport units', async ({ page }) => {
  await page.route(/\/(?:site|landing)\.css$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(/max-height:[^;]*dvh[^;]*;/g, '') });
  });
  await page.setViewportSize({ width: 740, height: 320 });
  await page.goto('/pricing');
  await page.locator('.landing-mobile-nav > summary').click();
  const menu = page.getByRole('navigation', { name: 'Mobile primary', exact: true });
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(320);
  const signup = menu.getByRole('link', { name: 'Create your workspace', exact: true });
  await signup.scrollIntoViewIfNeeded();
  await signup.click();
  await expect(page).toHaveURL(/\/app\/login\?mode=signup$/);
});

test('public navigation stays opaque and readable without CSS color mixing', async ({ page }) => {
  await page.route(/\/(?:site|landing)\.css$/, async (route) => {
    const response = await route.fetch();
    const css = (await response.text()).replace(/[\w-]+\s*:\s*[^;{}]*color-mix\([^;{}]*;/g, '');
    await route.fulfill({ response, body: css });
  });
  for (const pathname of ['/features', '/pricing', '/terms', '/404.html']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pathname);
    await page.locator('.landing-mobile-nav > summary').click();
    const colors = await page.locator('.landing-mobile-nav nav').evaluate((menu) => ({
      menu: getComputedStyle(menu).backgroundColor,
      header: getComputedStyle(document.querySelector('.site-header')!).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
    }));
    expect(colors.menu).toBe(colors.body);
    expect(colors.header).toBe(colors.body);
    expect(colors.body).not.toBe('rgba(0, 0, 0, 0)');
  }
});

test('a missing public URL returns the branded 404 with working navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto('/missing-public-page-brand-regression');
  expect(response?.status()).toBe(404);
  await expect(page.locator('body')).toHaveClass(/\bmarketing-page\b/);
  await expect(page.getByRole('heading', { name: 'That page doesn’t exist.' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await page.locator('.landing-mobile-nav > summary').click();
  await page
    .getByRole('navigation', { name: 'Mobile primary', exact: true })
    .getByRole('link', { name: 'Features', exact: true })
    .click();
  await expect(page).toHaveURL(/\/features$/);
});

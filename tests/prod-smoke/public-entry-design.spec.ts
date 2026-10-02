import { expect, test, type Page } from '@playwright/test';

async function assertFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  // Full-page screenshots do not scroll; hydrate the real lazy artwork first.
  for (const container of await page.locator('[data-landing-image]').all()) {
    await container.scrollIntoViewIfNeeded();
    await expect.poll(() => container.locator('img').count()).toBeGreaterThan(0);
  }
  for (const picture of await page.locator('main img').all()) {
    if (await picture.isVisible()) {
      await picture.scrollIntoViewIfNeeded();
      await picture.evaluate((element: HTMLImageElement) => element.decode());
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/workspace-public-${name}.png`, fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/metrics', (route) => route.fulfill({ status: 204 }));
});

for (const width of [1440, 390]) {
  test(`public pages share branding and usable navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, name] of [
      ['/', 'home'],
      ['/features', 'features'],
      ['/pricing', 'pricing'],
      ['/demo', 'tour'],
      ['/resources', 'resources'],
      ['/privacy', 'privacy'],
    ]) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('header .brand img')).toHaveAttribute('src', '/brand/xbar-wordmark.png');
      await expect(page.locator('link[href="/typography.css"]')).toHaveCount(1);
      await expect(page.locator('header').getByRole('link', { name: 'Help & support' })).toBeInViewport();
      await assertFits(page);
      await capture(page, `${name}-${width}`);
    }
    if (width === 390) {
      const summary = page.locator('.landing-mobile-nav > summary');
      const menu = page.getByRole('navigation', { name: 'Mobile primary' });
      await summary.click();
      await expect(menu.getByRole('link', { name: 'Pricing', exact: true })).toBeVisible();
      await menu.getByRole('link', { name: 'Pricing', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(summary).toBeFocused();
      await summary.click();
      await page.locator('main h1').click();
      await expect(menu).toBeHidden();
      await summary.click();
      await menu.getByRole('link', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/login$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/privacy$/);
      await expect(page.locator('main h1')).toBeVisible();
    }
  });

  test(`auth and optional setup details stay readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/login?mode=signup');
    await expect(page.getByRole('heading', { name: 'Create Account', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cloud sign-in is not configured here' })).toBeVisible();
    await expect(page.locator('.clean-brand__wordmark')).toHaveAttribute('src', '/brand/xbar-wordmark.png');
    await page.getByLabel('Email or User ID').fill('design-check@xbar.test');
    await page.getByLabel('Password', { exact: true }).fill('review-only-password');
    await page.getByRole('button', { name: 'Show entered value' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide entered value' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
    await assertFits(page);
    await capture(page, `signup-${width}`);

    await page.goto('/app/reset-password');
    await expect(page.getByRole('heading', { name: 'New Password' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Cloud accounts are not configured');
    const recovery = await page.locator('.clean-login-layout--recovery').boundingBox();
    expect(recovery).not.toBeNull();
    expect(Math.abs(recovery!.x - (width - recovery!.width) / 2)).toBeLessThan(2);
    await assertFits(page);
    await capture(page, `recovery-${width}`);

    await page.evaluate(() => localStorage.setItem('xbar-command-center-entry', 'true'));
    await page.goto('/app/setup');
    await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toBeVisible();
    await expect(page.getByLabel('Business name')).toBeVisible();
    await expect(page.getByLabel('Ranch name')).toBeVisible();
    await expect(page.getByLabel('Default owner')).toBeHidden();
    await assertFits(page);
    await capture(page, `setup-${width}`);
    const disclosure = page.locator('.clean-setup-details > summary');
    await disclosure.click();
    await page.getByLabel('Default owner').fill('Review Owner');
    await page.getByLabel('Home barn').fill('North Barn');
    await disclosure.click();
    await expect(page.getByLabel('Default owner')).toBeHidden();
    await disclosure.click();
    await expect(page.getByLabel('Default owner')).toHaveValue('Review Owner');
    await expect(page.getByLabel('Home barn')).toHaveValue('North Barn');
    await assertFits(page);
    await capture(page, `setup-details-${width}`);

    await page.getByLabel('Business name').fill('Review Ranch LLC');
    await page.getByLabel('Ranch name').fill('Review Ranch');
    await disclosure.click();
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    const readDefaults = () =>
      page.evaluate(async () => {
        const raw = await new Promise<string>((resolve, reject) => {
          const request = indexedDB.open('xbar-workspace', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const read = db.transaction('persist', 'readonly').objectStore('persist').get('xbar-live-workspace');
            read.onsuccess = () => {
              db.close();
              resolve(typeof read.result === 'string' ? read.result : '{}');
            };
            read.onerror = () => {
              db.close();
              reject(read.error);
            };
          };
        });
        const profile = JSON.parse(raw).state?.workspaceProfile;
        return { owner: profile?.defaultOwnerName, barn: profile?.defaultBarn };
      });
    await expect.poll(readDefaults).toEqual({ owner: 'Review Owner', barn: 'North Barn' });
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('.xs-shell')).toBeVisible();
    await expect.poll(readDefaults).toEqual({ owner: 'Review Owner', barn: 'North Barn' });
  });
}

test('public details and navigation work with JavaScript disabled', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/features');
    const group = page
      .locator('.feature-group')
      .filter({ has: page.getByText('Ownership & transfer integrity', { exact: true }) });
    await expect(group.getByText('Ownership record per horse', { exact: true })).toBeHidden();
    await group.locator('summary').click();
    await expect(group.getByText('Ownership record per horse', { exact: true })).toBeVisible();
    await page.locator('.landing-mobile-nav > summary').click();
    await page
      .getByRole('navigation', { name: 'Mobile primary' })
      .getByRole('link', { name: 'Pricing', exact: true })
      .click();
    await expect(page.getByText('Monthly billing is available.', { exact: false })).toBeVisible();
    const starter = page.locator('.plan').first();
    await expect(starter.getByText('Documents with OCR intake and review', { exact: true })).toBeHidden();
    await starter.locator('summary').click();
    await expect(starter.getByText('Documents with OCR intake and review', { exact: true })).toBeVisible();
    await assertFits(page);
  } finally {
    await context.close();
  }
});

for (const width of [320, 1120, 1121]) {
  test(`public header fits its ${width}px boundary`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['/', '/pricing']) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('header .brand')).toBeInViewport();
      await expect(page.locator('header').getByRole('link', { name: 'Help & support' })).toBeInViewport();
      await assertFits(page);
      if (width <= 1120) await expect(page.locator('.landing-mobile-nav > summary')).toBeInViewport();
      else await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeInViewport();
    }
  });
}

test('entry feedback styles clear AA contrast on their real surfaces', async ({ page }) => {
  await page.goto('/app/login');
  await expect(page.getByRole('heading', { name: 'Sign In', exact: true })).toBeVisible();
  // Style fixtures only; real auth outcomes remain covered by auth-smoke.
  const contrasts = await page
    .locator('.clean-auth-card')
    .first()
    .evaluate((card) => {
      const luminance = (color: string) => {
        const values = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
      };
      return ['error', 'success'].map((tone) => {
        const sample = document.createElement('p');
        sample.className = `clean-auth-message clean-auth-message--${tone}`;
        sample.textContent = 'Feedback contrast sample';
        card.append(sample);
        const style = getComputedStyle(sample);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        sample.remove();
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
    });
  for (const ratio of contrasts) expect(ratio).toBeGreaterThanOrEqual(4.5);
});

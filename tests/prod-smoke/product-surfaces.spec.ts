import { expect, test, type Page } from '@playwright/test';

/**
 * Product-surface smoke — extends the boot smoke to the two revenue-critical
 * screens: the Documents pipeline and the Billing plans page. Runs against the
 * built `dist` output in local-first mode, so it holds without Supabase or
 * Stripe configuration.
 */

const CRITICAL_ERROR =
  /__SECRET_INTERNALS|Cannot read (?:property|properties)|is not a function|is not defined|Minified React error|ChunkLoadError|Loading chunk \S+ failed|Failed to fetch dynamically imported module|SyntaxError|Unexpected (?:token|identifier)|Rendered fewer hooks|Maximum update depth/i;

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && CRITICAL_ERROR.test(msg.text())) {
      errors.push(msg.text());
    }
  });
  return errors;
}

async function completeLocalOnboarding(page: Page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/setup/, { timeout: 15_000 });
  await page.getByLabel('Business name').fill('XBAR LLC');
  await page.getByLabel('Ranch name').fill('Primary Ranch');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/setup'), { timeout: 20_000 });
}

async function goToRoute(page: Page, path: string) {
  // Client-side navigation (pushState + popstate drives React Router), same
  // technique as the legacy-redirect walk: avoids full reloads and IndexedDB
  // rehydration flake in constrained environments.
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForURL((url) => url.pathname === path, { timeout: 15_000 });
}

test('documents pipeline renders five workflow stages and the read-only library', async ({ page }) => {
  const errors = collectPageErrors(page);
  await completeLocalOnboarding(page);
  await goToRoute(page, '/app/documents');

  await expect(page.getByText('Your Documents')).toBeVisible({ timeout: 15_000 });
  const tabs = page.getByRole('tablist', { name: 'Document pipeline stages' }).getByRole('tab');
  await expect(tabs).toHaveCount(6);
  for (const label of ['Upload', 'Text extraction', 'Review', 'Ownership', 'Share', 'Library']) {
    await expect(tabs.filter({ hasText: label }).first()).toBeVisible();
  }

  // Stage switching is client-state only and must not throw.
  await tabs.filter({ hasText: 'Review' }).first().click();
  await tabs.filter({ hasText: 'Library' }).first().click();
  await page.getByRole('button', { name: 'Archived (0)', exact: true }).click();
  await expect(page.getByText('No archived documents', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Restore|Move)$/ })).toHaveCount(0);
  await tabs.filter({ hasText: 'Upload' }).first().click();
  expect(errors, `runtime errors on /documents:\n${errors.join('\n')}`).toEqual([]);
});

test('billing keeps local setup and offers only the two approved monthly paid plans', async ({ page }) => {
  const errors = collectPageErrors(page);
  await completeLocalOnboarding(page);
  await goToRoute(page, '/app/billing');
  await expect(page.getByRole('heading', { name: 'Review Billing', exact: true })).toBeVisible();

  const cards = page.locator('.checkout-plan-list .checkout-plan');
  await expect(cards).toHaveCount(2);
  for (const [tier, price] of [
    ['Professional', '$19.99'],
    ['Ranch Ops', '$49.99'],
  ]) {
    const card = cards.filter({ has: page.getByRole('heading', { name: tier, exact: true }) });
    await expect(card).toBeVisible();
    await expect(card.locator('.checkout-plan__price strong')).toHaveText(price);
    await expect(card.locator('.checkout-plan__price small')).toHaveText('/ month');
  }
  for (const tier of ['Starter', 'Enterprise']) {
    await expect(cards.getByRole('heading', { name: tier, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Choose ${tier}`, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('group', { name: 'Billing period' })).toHaveCount(0);
  const setup = page.locator('.checkout-trial');
  await expect(setup.getByText('Setup active', { exact: true })).toBeVisible();
  await expect(setup.getByText(/No card required/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Billing not configured yet', exact: true })).toBeDisabled();
  expect(errors, `runtime errors on /billing:\n${errors.join('\n')}`).toEqual([]);
});

test.describe('screen recovery without cached assets', () => {
  test.use({ serviceWorkers: 'block' });

  for (const extension of ['js', 'css']) {
    test(`a missing billing ${extension} asset offers recovery without deleting the saved workspace`, async ({
      page,
    }) => {
      const billingAsset = `**/assets/Subscriptions-*.${extension}`;
      await page.route(billingAsset, (route) => route.fulfill({ status: 404, body: 'Unavailable' }));
      await completeLocalOnboarding(page);
      await goToRoute(page, '/app/billing');

      await expect(page.getByRole('heading', { name: 'This screen could not load' })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('Reloading does not clear saved workspace data.');
      await expect(page.getByRole('alert')).toContainText('Any unsaved edits on this screen may be lost.');
      await expect(page.getByRole('button', { name: 'Clear browser workspace' })).toHaveCount(0);
      await expect(page.getByText('Technical details')).toBeVisible();

      await page.unroute(billingAsset);
      await page.getByRole('button', { name: 'Reload app', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Review Billing' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Primary Ranch', { exact: false }).first()).toBeVisible();
      await expect(page).toHaveURL(/\/app\/billing$/);
    });
  }
});

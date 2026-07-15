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

test('documents pipeline renders all five workflow stages', async ({ page }) => {
  const errors = collectPageErrors(page);
  await completeLocalOnboarding(page);
  await goToRoute(page, '/app/documents');

  await expect(page.getByText('Your Documents')).toBeVisible({ timeout: 15_000 });
  const tabs = page.getByRole('tablist', { name: 'Document pipeline stages' }).getByRole('tab');
  await expect(tabs).toHaveCount(5);
  for (const label of ['Upload', 'OCR / Processing', 'Review', 'Ownership', 'Share']) {
    await expect(tabs.filter({ hasText: label }).first()).toBeVisible();
  }

  // Stage switching is client-state only and must not throw.
  await tabs.filter({ hasText: 'Review' }).first().click();
  await tabs.filter({ hasText: 'Upload' }).first().click();
  expect(errors, `runtime errors on /documents:\n${errors.join('\n')}`).toEqual([]);
});

test('billing page renders every advertised subscription tier', async ({ page }) => {
  const errors = collectPageErrors(page);
  await completeLocalOnboarding(page);
  await goToRoute(page, '/app/billing');

  for (const tier of ['Starter', 'Professional', 'Ranch Ops', 'Enterprise']) {
    await expect(page.getByText(tier).first()).toBeVisible({ timeout: 15_000 });
  }
  expect(errors, `runtime errors on /billing:\n${errors.join('\n')}`).toEqual([]);
});

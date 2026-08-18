import { expect, test, type Page } from '@playwright/test';

// These run against the built native bundle — the exact artifact `npx cap sync`
// copies into the iOS project. They are the only place that proves the store
// build behaves differently from the web build: the gates are runtime checks a
// bundler cannot tree-shake, so the strings still exist in the JavaScript and
// grepping the bundle proves nothing. What renders is what matters.
//
// Two builds feed this file (see scripts/build-mobile-smoke.mjs). Tests tagged
// @auth run against a Supabase-configured bundle; the rest run against a
// local-mode bundle where a workspace can be created without a session, which
// is what makes the billing screen reachable. Each assertion is written so it
// can only pass because of the native gate, never because the feature behind it
// was unconfigured.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    // The same local-entry flag the e2e suite sets. RequireCloudAuth sends an
    // unstarted visitor to /login otherwise, so without this the billing
    // assertions would never reach the billing screen.
    window.localStorage.setItem('xbar-command-center-entry', 'true');
  });
});

async function openBillingScreen(page: Page) {
  // Go straight to setup rather than letting the guard bounce us there: billing
  // always requires a workspace in a fresh profile, so make that explicit.
  await page.goto('/#/setup');

  await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toBeVisible({ timeout: 30_000 });

  await page.getByPlaceholder('XBAR LLC').fill('XBAR Holdings');
  await page.getByPlaceholder('Primary Ranch').fill('Thunder Horse Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Erin Wyrick');
  await page.getByPlaceholder('ops@xbar.com').fill('ops@xbar.test');
  await page.getByPlaceholder('Legal owner').fill('Thunder Horse Ranch');
  await page.getByPlaceholder('Owner entity').fill('Thunder Horse Ranch LLC');
  await page.getByPlaceholder('Barn A').fill('Barn A');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  // Wait for the workspace to actually exist before moving on; navigating while
  // creation is still in flight lands back on /setup.
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible({
    timeout: 30_000,
  });

  // Navigate by hash rather than page.goto: a document reload re-runs the init
  // script, which clears storage and would discard the new workspace.
  await page.evaluate(() => {
    window.location.hash = '#/billing';
  });

  await expect(page.getByRole('heading', { name: 'Review Billing' })).toBeVisible({ timeout: 30_000 });
}

test('the store build offers no purchase path on the billing screen', async ({ page }) => {
  await openBillingScreen(page);

  // Guideline 3.1.1: no call to action for a purchase outside In-App Purchase.
  // This build has Stripe payment links configured, so on web these buttons
  // would render and be clickable.
  await expect(page.getByRole('button', { name: /^Choose (Starter|Professional|Ranch Ops|Enterprise)$/ })).toHaveCount(
    0,
  );

  // What the customer sees instead, and it must not be actionable.
  const managed = page.getByRole('button', { name: 'Managed outside the app' }).first();
  await expect(managed).toBeVisible();
  await expect(managed).toBeDisabled();
});

test('the store build never links out to Stripe or the pricing page', async ({ page }) => {
  await openBillingScreen(page);

  await expect(page.locator('a[href*="stripe"], a[href*="/pricing"]')).toHaveCount(0);
});

test('the store build resolves marketing links to the public site, not dead paths', async ({ page }) => {
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: /Sign In|Create Account/ })).toBeVisible({ timeout: 30_000 });

  // A bare "/pricing", "/privacy" or "/terms" cannot resolve inside the WebView
  // and reads as a broken link to App Review (Guideline 2.1).
  await expect(page.locator('a[href^="/pricing"], a[href^="/privacy"], a[href^="/terms"]')).toHaveCount(0);
});

test('@auth the store build hides third-party sign-in, which cannot complete in a WebView', async ({ page }) => {
  await page.goto('/#/login');

  // Supabase IS configured in this build, so the social row is exactly what would
  // render on web. Its absence here is the native gate.
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('textbox', { name: /Email/ })).toBeVisible();

  await expect(page.getByText('or continue with')).toHaveCount(0);
  for (const provider of ['Google', 'Facebook', 'Apple']) {
    await expect(page.getByRole('button', { name: provider, exact: true })).toHaveCount(0);
  }

  // Email/password sign-in — the path that does work natively — is still offered.
  await expect(page.getByRole('textbox', { name: /Password/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
});

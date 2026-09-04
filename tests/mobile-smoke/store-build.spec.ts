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

// Creates a workspace and leaves the page on the dashboard. Billing and
// Settings both sit behind workspace setup, so both reach it this way.
async function createWorkspace(page: Page) {
  // Go straight to setup rather than letting the guard bounce us there: a fresh
  // profile always needs a workspace first, so make that explicit.
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
}

// Navigate by hash rather than page.goto: a document reload re-runs the init
// script, which clears storage and would discard the new workspace.
async function goToRoute(page: Page, hash: string) {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
}

async function openBillingScreen(page: Page) {
  await createWorkspace(page);
  await goToRoute(page, '#/billing');
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

test('the store build does not present the paywall at all', async ({ page }) => {
  /*
   * This replaces an assertion that could not fail.
   *
   * It was `expect(locator('a[href*="stripe"], a[href*="/pricing"]')).toHaveCount(0)`
   * on the billing screen, and it passes on a WEB build too: checkout is
   * reached through window.location.assign in a click handler, never through an
   * anchor, so there is no such link in either bundle. The test asserted the
   * absence of something that never exists. Verified rather than assumed --
   * rebuilding this bundle with VITE_NATIVE_APP unset leaves it green while the
   * other two fail.
   *
   * What genuinely differs is whether the paywall is DRAWN. This build has
   * payment links configured, so on web the panel reads "Due at checkout" and
   * renders a card-details box with card number, expiration and CVC rows.
   * Guideline 3.1.1 forbids presenting a non-IAP purchase, not merely
   * completing one, so a store build showing a card form is the rejection even
   * with every button disabled.
   */
  await openBillingScreen(page);

  await expect(page.getByText('Card details')).toHaveCount(0);
  await expect(page.getByText('Secure checkout')).toHaveCount(0);
  await expect(page.getByText('Due at checkout')).toHaveCount(0);
  await expect(page.getByText('Entered on the next secure step')).toHaveCount(0);
  await expect(page.getByText('Handled at checkout')).toHaveCount(0);

  // And what it shows instead, so this cannot pass because the screen failed to
  // render at all.
  await expect(page.getByText('Managed outside the app').first()).toBeVisible();
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

test('@auth an account with no password still has a way into the store build', async ({ page }) => {
  // Hiding OAuth on native removed the only credential an account created
  // through Google, Apple or Facebook has. Password reset cannot rescue it
  // either: that email's callback is built from the page origin, which is
  // capacitor://localhost in the app. A one-time code is verified in-app with
  // no callback at all, so it must be reachable from the signed-out screen —
  // otherwise those customers are locked out of iOS entirely.
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible({ timeout: 30_000 });

  const requestCode = page.getByRole('button', { name: 'Email me a sign-in code' });
  await expect(requestCode).toBeVisible();

  // Disabled until an email is present, then actionable — it must not be decorative.
  await expect(requestCode).toBeDisabled();
  await page.getByRole('textbox', { name: /Email/ }).fill('owner@xbar.test');
  await expect(requestCode).toBeEnabled();

  // Reachable is not the same as findable. An OAuth-only customer arrives at
  // this screen with no idea why their Google button vanished, so the control
  // has to say who it is for — otherwise they read the app as broken and leave.
  await expect(page.getByText(/If you first signed up with Google, Apple or Facebook/)).toBeVisible();
});

/*
 * Two tests from the original suite are deliberately absent rather than
 * adapted, because the features they cover are not on this branch:
 *
 *   - the backup export refusing instead of silently doing nothing, which
 *     belongs with the fileDownload work
 *   - "See what {tier} includes", which needs the separate change that split
 *     reviewing a plan from buying one
 *
 * Porting them here would mean asserting on code that does not exist, and the
 * only way to make that pass is to weaken the assertion until it proves
 * nothing. They come with their own changes.
 */

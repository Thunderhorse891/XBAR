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
  await page.getByPlaceholder('ops@yourranch.com').fill('ops@xbar.test');
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

test('the native workflow checklist excludes the paid-plan step and keeps its own progress total', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createWorkspace(page);
  await goToRoute(page, '#/getting-started');
  await expect(page.getByRole('heading', { name: 'Getting started', exact: true })).toBeVisible();

  const checklist = page.locator('.xs-card').filter({ hasText: 'Workflow checklist' });
  await expect(checklist).toContainText('1 of 6 steps are complete.');
  await expect(page.locator('.xs-checkitem')).toHaveCount(6);
  await expect(page.getByText('Review billing', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open billing', exact: true })).toHaveCount(0);
  await expect(page.getByText(/\d+% set up/)).toHaveCount(0);

  await goToRoute(page, '#/billing');
  await expect(page.getByRole('heading', { name: 'Billing status', exact: true })).toBeVisible();
  await page.goBack();
  await expect(checklist).toContainText('1 of 6 steps are complete.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('direct and legacy billing routes show plan status, not a web paywall or a checkout return', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const billingRequests: string[] = [];
  await page.route(/\/api\/stripe(?:\/|$)|\/api\/billing(?:\/|$)|stripe\.com/, async (route) => {
    billingRequests.push(route.request().url());
    await route.abort();
  });

  await createWorkspace(page);
  for (const hash of [
    '#/billing',
    '#/billing?plan=Ranch%20Ops&checkout=success',
    '#/billing?plan=Professional&checkout=cancelled',
    '#/subscribe',
    '#/plans',
    '#/subscriptions',
  ]) {
    await goToRoute(page, hash);
    await expect(page).toHaveURL(/#\/billing(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Billing status', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Current workspace plan' })).toBeVisible();
    const plan = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Current workspace plan' }) });
    await expect(
      plan.getByText('Purchases and plan changes are not available in this app.', { exact: true }),
    ).toBeVisible();
    const status = plan.getByRole('status');
    await expect(status).toBeVisible();
    await expect(status).toHaveText('Starter');
    await expect(page.getByRole('button', { name: /checkout|trial|choose|manage subscription/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /checkout|trial|choose|manage subscription/i })).toHaveCount(0);
    await expect(page.getByText(/Secure checkout|Checkout cancelled|Due at checkout|Card details/i)).toHaveCount(0);
  }
  expect(billingRequests).toEqual([]);
});

test('the store build resolves marketing links to the public site, not dead paths', async ({ page }) => {
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: /Sign In|Create Account/ })).toBeVisible({ timeout: 30_000 });

  // A bare "/pricing", "/privacy" or "/terms" cannot resolve inside the WebView
  // and reads as a broken link to App Review (Guideline 2.1).
  await expect(page.locator('a[href^="/pricing"], a[href^="/privacy"], a[href^="/terms"]')).toHaveCount(0);
});

test('the native privacy policy remains findable before and after ranch setup', async ({ page }) => {
  await page.goto('/#/setup');
  await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toBeVisible();
  const privacy = page.getByRole('link', { name: 'Privacy Policy', exact: true });
  await expect(privacy).toBeVisible();
  await expect(privacy).toHaveAttribute('href', /^https:\/\/[^/]+\/privacy$/);
  const privacyUrl = await privacy.getAttribute('href');

  await createWorkspace(page);
  await goToRoute(page, '#/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  expect(privacyUrl).not.toBeNull();
  await expect(privacy).toBeVisible();
  await expect(privacy).toHaveAttribute('href', privacyUrl!);
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

test('@auth a rejected auth callback lands on sign-in with the reason, not not-found', async ({ page }) => {
  /*
   * This bundle is the only hash-routing build there is, which is why the case
   * lives here.
   *
   * An expired link, a cancelled OAuth consent and a rejected magic link all
   * come back as `#error=...`. auth-js stops before clearing that fragment and
   * emits nothing, so nothing navigates -- and on a hash router the fragment
   * IS the route, so it matched nothing and the customer was shown "Page not
   * found" at the moment they most needed to be told what went wrong.
   *
   * Sign-in rather than the reset screen: the fragment says nothing about
   * which flow it belonged to, so answering all of them with password-reset
   * instructions was wrong for three cases out of four.
   */
  await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Email+link+has+expired');

  await expect(page.getByText('Email link has expired')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Page not found')).toHaveCount(0);
  // On the sign-in screen, with a way onwards rather than a dead end.
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('@auth the sign-in screen still renders when site data is blocked', async ({ page }) => {
  /*
   * `remember me` was read straight from localStorage in a `useState`
   * initializer -- during RENDER. Reaching for it throws outright in a browser
   * configured to block site data, so the error boundary replaced the first
   * screen a customer ever sees. An earlier fix covered four such call sites
   * and did not reach this one, because the case it was tested against was the
   * reset screen.
   */
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access to storage is not allowed from this context.', 'SecurityError');
      },
    });
  });

  await page.goto('/#/login');
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('This screen hit a runtime problem')).toHaveCount(0);
});

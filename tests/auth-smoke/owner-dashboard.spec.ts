import { expect, test, type Page } from '@playwright/test';
import {
  blockWebfonts,
  sessionLink,
  stubGoTrueUser,
  refreshedSession,
  SECOND,
  OWNER,
  type Identity,
} from './support.js';

blockWebfonts();

test('native runtime never exposes the web owner billing route or requests customer data', async ({ page }) => {
  await page.addInitScript(() =>
    Object.assign(window, { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }),
  );
  let requests = 0;
  await page.route('**/api/account/owner-*', (r) => {
    requests += 1;
    return r.fulfill({ status: 403, json: { ok: false } });
  });
  await signIn(page);
  await expect(page).not.toHaveURL(/\/app\/owner/);
  await expect(page.getByRole('heading', { name: 'Your XBAR business' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Payments & refunds' })).toHaveCount(0);
  expect(requests).toBe(0);
});
const sample = {
  ok: true,
  mode: 'live',
  fetchedAt: '2026-10-23T12:00:00Z',
  nextCursor: 'sub_first',
  billingUrl: 'https://dashboard.stripe.com/acct_synthetic/subscriptions',
  paymentsUrl: 'https://dashboard.stripe.com/acct_synthetic/payments',
  readiness: {
    ok: true,
    checks: { billingReady: true },
    subsystems: { email: false, remindersCron: true },
    warnings: ['No email provider is configured. Lifecycle emails are not sent.'],
  },
  subscriptions: [
    {
      id: 'sub_first',
      customerId: 'cus_first',
      name: 'Synthetic Ranch Customer',
      email: 'customer@example.invalid',
      status: 'active',
      cancelAtPeriodEnd: false,
      cancelAt: null,
      trialEnd: null,
      collectionPaused: false,
      createdAt: 1760000000,
      morePrices: false,
      prices: [
        {
          id: 'price_example',
          amount: 2900,
          currency: 'usd',
          interval: 'month',
          intervalCount: 1,
          quantity: 1,
          periodEnd: 1800000000,
        },
      ],
      workspaces: [
        {
          id: 'workspace1',
          name: 'Synthetic Ranch',
          tier: 'Professional',
          billingState: 'Active',
          syncedAt: '2026-10-23',
        },
      ],
      subscriptionUrl: 'https://dashboard.stripe.com/acct_synthetic/subscriptions/sub_first',
      customerUrl: 'https://dashboard.stripe.com/acct_synthetic/customers/cus_first',
    },
  ],
};

async function signIn(page: Page, route = 'owner', identity: Identity = OWNER) {
  await stubGoTrueUser(page, undefined, identity);
  await page.route('**/auth/v1/logout*', (r) => r.fulfill({ status: 204 }));
  await page.goto(sessionLink('signin', identity).replace('/reset-password', `/${route}`));
}

test('owner sees live records, paging, filters and actionable readiness on desktop and mobile', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/account/owner-dashboard*', (r) => {
    const url = new URL(r.request().url());
    requests.push(url.search);
    return r.fulfill({
      json:
        url.searchParams.has('after') || url.searchParams.get('status') !== 'all'
          ? { ...sample, subscriptions: [], nextCursor: null }
          : sample,
    });
  });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Synthetic Ranch Customer' })).toBeVisible();
  await expect(page.getByText('No email provider is configured.', { exact: false })).toBeVisible();
  await expect(page.getByText('$29.00 / month')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage subscription', exact: true })).toHaveAttribute(
    'href',
    sample.subscriptions[0].subscriptionUrl,
  );
  await expect(page.getByRole('link', { name: 'Manage subscription', exact: true })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await page.screenshot({ path: 'test-results/owner-dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/owner-dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No subscriptions in this view' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  expect(requests.some((q) => q.includes('after=sub_first'))).toBe(true);
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic Ranch Customer' })).toBeVisible();
  await page.getByLabel('Subscription status').selectOption('past_due');
  await expect(page.getByRole('heading', { name: 'No subscriptions in this view' })).toBeVisible();
  expect(requests.at(-1)).toBe('?status=past_due');
});

test('another authenticated user is refused on the direct owner route', async ({ page }) => {
  await page.route('**/api/account/owner-dashboard*', (r) =>
    r.fulfill({ status: 403, json: { ok: false, message: 'This dashboard is reserved for the XBAR owner.' } }),
  );
  await signIn(page, 'owner', SECOND);
  await expect(page.getByRole('heading', { name: 'Owner access required' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Customers & subscriptions' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Payments & refunds' })).toHaveCount(0);
});

test('provider failures show an error, never a false zero-customer dashboard, and retry recovers', async ({ page }) => {
  let fail = true;
  await page.route('**/api/account/owner-dashboard*', (r) =>
    r.fulfill(
      fail ? { status: 503, json: { ok: false, message: 'Customer data could not be verified.' } } : { json: sample },
    ),
  );
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Dashboard unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No subscriptions in this view' })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic Ranch Customer' })).toBeVisible();
});

test('signing out clears the visible customer records and customer data is not persisted', async ({ page }) => {
  await page.route('**/api/account/owner-dashboard*', (r) => r.fulfill({ json: sample }));
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Synthetic Ranch Customer' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }).includes('customer@example.invalid'),
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/login$/);
  await expect(page.getByText('customer@example.invalid')).toHaveCount(0);
});

test('switching identity removes owner data while the new identity request is pending', async ({ page }) => {
  let secondRequest = false;
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/account/owner-dashboard*', async (r) => {
    if (secondRequest) {
      await held;
      await r.fulfill({ status: 403, json: { ok: false, message: 'Owner access required.' } });
    } else await r.fulfill({ json: sample });
  });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Synthetic Ranch Customer' })).toBeVisible();
  secondRequest = true;
  await stubGoTrueUser(page, undefined, SECOND);
  await page.evaluate(
    (session) => {
      // auth-js stores a new session before broadcasting it. A bare broadcast
      // conflicts with the old stored identity and is correctly ignored.
      localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
      const channel = new BroadcastChannel('sb-127-auth-token');
      channel.postMessage({ event: 'SIGNED_IN', session });
      channel.close();
    },
    refreshedSession('second-session', SECOND),
  );
  await expect(page.getByText('customer@example.invalid')).toHaveCount(0);
  release?.();
  await expect(page.getByRole('heading', { name: 'Owner access required' })).toBeVisible();
});

test('a normal owner sign-in lands on the owner dashboard after a server grant', async ({ page }) => {
  await page.route('**/api/account/owner-access', (r) => r.fulfill({ json: { ok: true, owner: true } }));
  await page.route('**/api/account/owner-dashboard*', (r) => r.fulfill({ json: sample }));
  await signIn(page, 'login');
  await expect(page).toHaveURL(/\/app\/owner$/);
  await expect(page.getByRole('heading', { name: 'Synthetic Ranch Customer' })).toBeVisible();
});

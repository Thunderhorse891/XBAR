import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
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
    // Simulate an older server: the client must not echo configuration text.
    warnings: ['No email provider is configured (RESEND_API_KEY, SENDGRID_API_KEY or SMTP).'],
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

const directory = {
  ok: true,
  fetchedAt: sample.fetchedAt,
  page: 1,
  nextPage: 2,
  accounts: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      email: 'trial-account@example.invalid',
      emailConfirmed: false,
      createdAt: sample.fetchedAt,
      lastSignInAt: null,
      ownedWorkspaces: [
        {
          id: 'trial-ranch',
          name: 'Trial only ranch',
          tier: 'Professional',
          billingState: 'Trial',
          syncedAt: sample.fetchedAt,
        },
      ],
    },
  ],
};
test.beforeEach(async ({ page }) => {
  await page.route('**/api/account/owner-readiness', (r) =>
    r.fulfill({ json: { ok: true, fetchedAt: sample.fetchedAt, readiness: sample.readiness } }),
  );
  await page.route('**/api/account/owner-accounts*', (r) =>
    r.fulfill({ json: { ...directory, accounts: [], nextPage: null } }),
  );
});

test('owner can inspect non-paying accounts and operations while billing fails, without billing retries', async ({
  page,
}) => {
  let billingCalls = 0;
  await page.route('**/api/account/owner-dashboard*', (r) => {
    billingCalls++;
    return r.fulfill({ status: 503, json: { ok: false, message: 'Billing cannot be verified.' } });
  });
  await page.route('**/api/account/owner-accounts*', (r) =>
    r.fulfill({
      json:
        new URL(r.request().url()).searchParams.get('page') === '2'
          ? { ...directory, page: 2, nextPage: null, accounts: [] }
          : directory,
    }),
  );
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Billing unavailable' })).toBeVisible();
  await expect(
    page.getByText('Email service is currently unavailable. Please contact support.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('trial-account@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByText('Trial only ranch', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No subscriptions in this view' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/owner-independent-sections-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/owner-independent-sections-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Next account page' }).click();
  await expect(page.getByText('No registered accounts on this page.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous account page' }).click();
  await expect(page.getByText('trial-account@example.invalid', { exact: true })).toBeVisible();
  expect(billingCalls).toBe(1);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }).includes('trial-account@example.invalid'),
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('trial-account@example.invalid')).toHaveCount(0);
});

test('account directory failures remain explicit while independent service status stays visible', async ({ page }) => {
  await page.route('**/api/account/owner-dashboard*', (r) =>
    r.fulfill({ status: 503, json: { ok: false, message: 'Billing cannot be verified.' } }),
  );
  await page.route('**/api/account/owner-accounts*', (r) =>
    r.fulfill({ status: 503, json: { ok: false, message: 'Registered accounts could not be verified.' } }),
  );
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Account directory unavailable' })).toBeVisible();
  await expect(page.getByText('No registered accounts on this page.', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Email service is currently unavailable. Please contact support.', { exact: false }),
  ).toBeVisible();
});

for (const action of ['owner-accounts', 'owner-readiness'])
  test(`an owner refusal on ${action} hides every customer section`, async ({ page }) => {
    await page.route('**/api/account/owner-dashboard*', (r) => r.fulfill({ json: sample }));
    await page.route(`**/api/account/${action}*`, (r) =>
      r.fulfill({ status: 403, json: { ok: false, message: 'Owner access required.' } }),
    );
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Owner access required' })).toBeVisible();
    await expect(page.getByText('customer@example.invalid')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Registered accounts' })).toHaveCount(0);
  });

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
  await expect(
    page.getByText('Email service is currently unavailable. Please contact support.', { exact: false }),
  ).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Billing unavailable' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
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
  for (const [action, body] of [
    ['owner-accounts', directory],
    ['owner-readiness', { ok: true, fetchedAt: sample.fetchedAt, readiness: sample.readiness }],
  ] as const) {
    await page.route(`**/api/account/${action}*`, async (r) => {
      if (secondRequest) {
        await held;
        await r.fulfill({ status: 403, json: { ok: false, message: 'Owner access required.' } });
      } else await r.fulfill({ json: body });
    });
  }
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Synthetic Ranch Customer' })).toBeVisible();
  await expect(page.getByText('trial-account@example.invalid', { exact: true })).toBeVisible();
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
  await expect(page.getByText('trial-account@example.invalid')).toHaveCount(0);
  await expect(
    page.getByText('Email service is currently unavailable. Please contact support.', { exact: false }),
  ).toHaveCount(0);
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

test('owner mobile recovery is readable, scrollable and keyboard accessible without internal diagnostics', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/account/owner-dashboard*', (r) =>
    r.fulfill({ status: 503, json: { ok: false, message: 'SMTP RESEND_API_KEY private diagnostic' } }),
  );
  await page.route('**/api/account/owner-readiness', (r) =>
    r.fulfill({ json: { ok: true, fetchedAt: '2026-11-27T00:15:00Z', readiness: sample.readiness } }),
  );
  await signIn(page);
  await expect(page.getByText('Email service is currently unavailable. Please contact support.')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/SMTP|RESEND_API_KEY|SENDGRID_API_KEY|private diagnostic/);
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-11-27T00:15:00.000Z');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const header = await page.locator('.owner-topbar').boundingBox();
  expect(header!.height).toBeLessThan(100);
  for (const control of await page
    .locator('.owner-shell a:visible, .owner-shell button:visible, .owner-shell select:visible')
    .all()) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'Account menu', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeFocused();
  await page.screenshot({ path: 'test-results/owner-account-menu-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeFocused();
  // Auth is stubbed, layout is the real built route. This is emulation, not Safari chrome proof.
  await page.locator('.owner-footnote').scrollIntoViewIfNeeded();
  await expect(page.locator('.owner-footnote')).toBeInViewport();
  await page.screenshot({ path: 'test-results/owner-recovery-after-mobile.png', fullPage: true });
  const colors = await page.locator('.owner-checked').evaluate((node) => ({
    foreground: getComputedStyle(node).color,
    background: getComputedStyle(node.closest('.owner-panel')!).backgroundColor,
    bottomPadding: getComputedStyle(document.querySelector('.owner-main')!).paddingBottom,
  }));
  await test.info().attach('computed-mobile-styles', { body: JSON.stringify(colors), contentType: 'application/json' });
  await writeFile(
    'test-results/owner-layout.json',
    JSON.stringify(
      {
        viewport: { width: 390, height: 844 },
        headerHeight: header!.height,
        ...colors,
        evidence: 'Built Chromium route with synthetic auth/API; no physical Safari chrome',
      },
      null,
      2,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/owner-recovery-after-desktop.png', fullPage: true });
});

test('account-menu sign-out failure stays actionable and retry clears the session', async ({ page }) => {
  await page.route('**/api/account/owner-dashboard*', (r) => r.fulfill({ json: sample }));
  await signIn(page);
  let fail = true;
  await page.route('**/auth/v1/logout*', (r) =>
    r.fulfill(fail ? { status: 400, json: { message: 'SMTP private diagnostic' } } : { status: 204 }),
  );
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Sign out failed. Try again from the account menu.');
  await expect(page.locator('body')).not.toContainText('private diagnostic');
  fail = false;
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/login/);
});

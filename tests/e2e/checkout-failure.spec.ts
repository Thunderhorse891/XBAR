import { expect, test, type Page, type Route } from '@playwright/test';

// Synthetic identities and local route handlers only. This exercises the real
// billing component without a Stripe session, live account, or external API.
async function openBilling(page: Page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4174(?:\/|$))/, (route) => route.abort());
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Billing Test');
  await page.getByPlaceholder('Primary Ranch').fill('Billing Ranch');
  await page.getByPlaceholder('Legal owner').fill('Test Owner');
  await page.getByPlaceholder('Owner entity').fill('Test Ranch');
  await page.getByPlaceholder('Barn A').fill('Barn A');
  await page.getByPlaceholder('Pasture 1').fill('North');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.evaluate(async () => {
    const cloudPath = '/src/store/useCloudStore.ts';
    const storePath = '/src/store/useXbarStore.ts';
    const configPath = '/src/lib/platformConfig.ts';
    const { useCloudStore } = await import(cloudPath);
    const { useXbarStore } = await import(storePath);
    const { stripeConfig, apiConfig } = await import(configPath);
    stripeConfig.managedBillingEnabled = true;
    apiConfig.baseUrl = '';
    useCloudStore.setState({
      workspaceId: 'workspace-a',
      session: { access_token: 'synthetic-token', user: { id: 'account-a' } },
    });
    useXbarStore.setState({
      currentRole: 'Admin',
      subscription: { ...useXbarStore.getState().subscription, billingState: 'Inactive' },
    });
    history.pushState({}, '', '/app/billing?plan=Professional');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Review Billing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to secure checkout' })).toBeEnabled();
}

async function stubCheckout(page: Page, onCheckout: (route: Route) => Promise<void> | void) {
  await page.route('**/api/stripe/checkout', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          ok: true,
          managed: true,
          sellable: { monthly: { Professional: true }, annual: { Professional: true } },
        },
      });
      return;
    }
    await onCheckout(route);
  });
}

const errorNotice = (page: Page) => page.getByRole('alert').filter({ hasText: 'Checkout needs attention' });
const refused = (route: Route, message = 'Professional monthly checkout is temporarily unavailable.') =>
  route.fulfill({ status: 503, json: { ok: false, code: 'price_unavailable', message } });

test('checkout refusal stays visible after the toast expires and clears while retrying', async ({ page }) => {
  const requests: Route[] = [];
  await stubCheckout(page, async (route) => {
    requests.push(route);
    if (requests.length === 1) await refused(route);
  });
  // Setup and checkout notifications must both use the clock advanced below.
  await page.clock.install();
  await openBilling(page);
  await page.getByRole('button', { name: 'Continue to secure checkout' }).click();
  await expect(errorNotice(page)).toContainText('Professional monthly checkout is temporarily unavailable.');
  // Error confirmations now remain for ten seconds; the inline refusal must outlive them.
  await page.clock.fastForward(11000);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await expect(errorNotice(page)).toBeVisible();
  await expect(errorNotice(page)).not.toContainText('were not changed');
  expect(requests[0].request().postDataJSON()).toMatchObject({
    tier: 'Professional',
    billingPeriod: 'monthly',
    workspaceId: 'workspace-a',
  });
  await page.getByRole('button', { name: 'Continue to secure checkout' }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(errorNotice(page)).toHaveCount(0);
  await expect(page.locator('.checkout-primary-action')).toBeDisabled();
  await refused(requests[1], 'The retry could not open checkout.');
  await expect(errorNotice(page)).toContainText('The retry could not open checkout.');
  await expect(errorNotice(page)).not.toContainText('Professional monthly checkout is temporarily unavailable.');
  await expect(page.locator('.checkout-primary-action')).toBeEnabled();
});

for (const change of ['plan', 'workspace', 'account', 'permission'] as const) {
  test(`a checkout error clears after a ${change} change`, async ({ page }) => {
    let attempts = 0;
    await stubCheckout(page, (route) => {
      if (++attempts === 1) return refused(route);
    });
    await openBilling(page);
    await page.getByRole('button', { name: 'Continue to secure checkout' }).click();
    await expect(errorNotice(page)).toBeVisible();
    if (change === 'plan') {
      await page.getByRole('button', { name: 'Choose Starter', exact: true }).click();
    } else {
      await page.evaluate(async (change) => {
        const cloudPath = '/src/store/useCloudStore.ts';
        const storePath = '/src/store/useXbarStore.ts';
        const { useCloudStore } = await import(cloudPath);
        const { useXbarStore } = await import(storePath);
        if (change === 'workspace') useCloudStore.setState({ workspaceId: 'workspace-b' });
        else if (change === 'account')
          useCloudStore.setState({ session: { access_token: 'other-token', user: { id: 'account-b' } } });
        else useXbarStore.setState({ currentRole: 'Owner' });
      }, change);
    }
    await expect(errorNotice(page)).toHaveCount(0);
  });
}

test('new annual checkout is not offered even when an old catalog advertises it', async ({ page }) => {
  await stubCheckout(page, refused);
  await openBilling(page);
  await expect(page.getByRole('button', { name: /Annual/ })).toHaveCount(0);
  await expect(page.locator('.checkout-billing-toggle')).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Free plan' })).toContainText('2 horses · 1 user · No card required');
  await expect(
    page.locator('.checkout-plan').filter({ has: page.getByRole('heading', { name: 'Starter', exact: true }) }),
  ).toContainText('$9');
});

test('a workspace round trip before a refusal cannot restore an invalidated inline error', async ({ page }) => {
  let pending: Route | undefined;
  await stubCheckout(page, (route) => {
    pending = route;
  });
  await openBilling(page);
  await page.getByRole('button', { name: 'Continue to secure checkout' }).click();
  await expect.poll(() => pending).toBeTruthy();
  await page.evaluate(async () => {
    const cloudPath = '/src/store/useCloudStore.ts';
    const { useCloudStore } = await import(cloudPath);
    useCloudStore.setState({ workspaceId: 'workspace-b' });
    useCloudStore.setState({ workspaceId: 'workspace-a' });
  });
  await refused(pending!);
  await expect(page.locator('.checkout-primary-action')).toBeEnabled();
  await expect(errorNotice(page)).toHaveCount(0);
});

test('refreshing a token for the same identity preserves the checkout error', async ({ page }) => {
  await stubCheckout(page, refused);
  await openBilling(page);
  await page.getByRole('button', { name: 'Continue to secure checkout' }).click();
  await expect(errorNotice(page)).toBeVisible();
  await page.evaluate(async () => {
    const cloudPath = '/src/store/useCloudStore.ts';
    const { useCloudStore } = await import(cloudPath);
    useCloudStore.setState({ session: { access_token: 'refreshed-token', user: { id: 'account-a' } } });
  });
  await expect(errorNotice(page)).toBeVisible();
});

for (const cadence of ['monthly', 'annual', 'unknown'] as const) {
  test(`existing purchased rate is shown truthfully for ${cadence} billing`, async ({ page }) => {
    await stubCheckout(page, refused);
    await openBilling(page);
    await page.evaluate(async (cadence) => {
      const storePath = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(storePath);
      useXbarStore.setState({
        subscription: {
          ...useXbarStore.getState().subscription,
          tier: 'Starter',
          purchasedTier: 'Starter',
          billingState: 'Active',
          monthlyRate: 12,
          annualRate: 120,
          billingPeriod: cadence === 'unknown' ? undefined : cadence,
        },
      });
    }, cadence);
    const summary = page.getByRole('status').filter({ hasText: 'Current subscription:' });
    await expect(summary).toContainText(
      cadence === 'annual' ? '$120 / year' : cadence === 'monthly' ? '$12 / month' : 'Billing cadence unavailable',
    );
    if (cadence === 'unknown') await expect(summary).not.toContainText('/ month');
  });
}

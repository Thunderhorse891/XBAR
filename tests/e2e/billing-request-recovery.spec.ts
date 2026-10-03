import { expect, test, type Page, type Route } from '@playwright/test';

const successfulTrial = () => ({
  ok: true,
  trial: {
    startedAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    plan: 'Professional',
  },
});

async function openBilling(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Billing Test');
  await page.getByPlaceholder('Primary Ranch').fill('Billing Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Test Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('billing@example.test');
  await page.getByPlaceholder('Legal owner').fill('Test Owner');
  await page.getByPlaceholder('Owner entity').fill('Test Ranch');
  await page.getByPlaceholder('Barn A').fill('Barn A');
  await page.getByPlaceholder('Pasture 1').fill('North');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Billing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review Billing' })).toBeVisible();
  await page.evaluate(async () => {
    const cloudPath = '/src/store/useCloudStore.ts';
    const storePath = '/src/store/useXbarStore.ts';
    const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
    const { useXbarStore } = await import(/* @vite-ignore */ storePath);
    useCloudStore.setState({
      workspaceId: 'workspace-a',
      session: { access_token: 'synthetic-token', user: { id: 'account-a' } },
    });
    useXbarStore.setState({
      currentRole: 'Admin',
      subscription: { ...useXbarStore.getState().subscription, billingState: 'Inactive' },
    });
  });
  await expect(page.getByRole('button', { name: 'Start 14-day trial', exact: true })).toBeEnabled();
}

test('an ordinary trial still activates after a token refresh for the same account and workspace', async ({ page }) => {
  await openBilling(page);
  await page.route('**/api/account/trial-start', async (route) => {
    await page.evaluate(async () => {
      const modulePath = '/src/store/useCloudStore.ts';
      const { useCloudStore } = await import(/* @vite-ignore */ modulePath);
      useCloudStore.setState({ session: { access_token: 'refreshed-token', user: { id: 'account-a' } } });
    });
    await route.fulfill({ json: successfulTrial() });
  });
  await page.getByRole('button', { name: 'Start 14-day trial', exact: true }).click();
  await expect(page.getByText('Professional trial started', { exact: true })).toBeVisible();
});

test('a stalled trial releases its button and reports an uncertain outcome', async ({ page }) => {
  await openBilling(page);
  await page.clock.install();
  let requestSeen = false;
  await page.route('**/api/account/trial-start', () => {
    requestSeen = true;
  });
  await page.getByRole('button', { name: 'Start 14-day trial', exact: true }).click();
  await expect.poll(() => requestSeen).toBe(true);
  await expect(
    page.locator('.checkout-trial').getByRole('button', { name: 'Starting trial…', exact: true }),
  ).toBeDisabled();
  await page.clock.fastForward(31_000);
  await expect(page.getByText(/We could not confirm whether the trial started/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start 14-day trial', exact: true })).toBeEnabled();
});

test('checkout does not redirect a switched workspace to the previous workspace payment', async ({ page }) => {
  await openBilling(page);
  await page.evaluate(async () => {
    const configPath = '/src/lib/platformConfig.ts';
    const storePath = '/src/store/useXbarStore.ts';
    const { stripeConfig } = await import(/* @vite-ignore */ configPath);
    const { useXbarStore } = await import(/* @vite-ignore */ storePath);
    stripeConfig.managedBillingEnabled = true;
    useXbarStore.setState({ subscription: { ...useXbarStore.getState().subscription } });
  });
  let release!: (route: Route) => void;
  const requested = new Promise<Route>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/stripe/checkout', (route) => release(route));
  let redirects = 0;
  await page.route('https://checkout.stripe.com/**', async (route) => {
    redirects += 1;
    await route.abort();
  });
  await page.getByRole('button', { name: 'Choose Professional', exact: true }).click();
  const route = await requested;
  expect(route.request().postDataJSON().workspaceId).toBe('workspace-a');
  await page.evaluate(async () => {
    const modulePath = '/src/store/useCloudStore.ts';
    const { useCloudStore } = await import(/* @vite-ignore */ modulePath);
    useCloudStore.setState({ workspaceId: 'workspace-b' });
  });
  await route.fulfill({ json: { ok: true, url: 'https://checkout.stripe.com/c/pay/synthetic' } });
  await expect(page.getByText('Billing request stopped', { exact: true })).toBeVisible();
  expect(redirects).toBe(0);
  await expect(page).toHaveURL(/\/app\/billing/);
});

for (const change of ['workspace', 'account', 'permission', 'workspace round trip'] as const) {
  test(`a delayed trial response is ignored after a ${change} change`, async ({ page }) => {
    await openBilling(page);
    let release!: (route: Route) => void;
    const requested = new Promise<Route>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/account/trial-start', (route) => release(route));
    await page.getByRole('button', { name: 'Start 14-day trial', exact: true }).click();
    const route = await requested;
    expect(route.request().postDataJSON()).toEqual({ workspaceId: 'workspace-a' });
    await page.evaluate(async (change) => {
      const cloudPath = '/src/store/useCloudStore.ts';
      const storePath = '/src/store/useXbarStore.ts';
      const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
      const { useXbarStore } = await import(/* @vite-ignore */ storePath);
      if (change === 'permission') useXbarStore.setState({ currentRole: 'Owner' });
      else if (change === 'account')
        useCloudStore.setState({ session: { access_token: 'other-token', user: { id: 'account-b' } } });
      else {
        useCloudStore.setState({ workspaceId: 'workspace-b' });
        if (change === 'workspace round trip') useCloudStore.setState({ workspaceId: 'workspace-a' });
      }
    }, change);
    const startedAt = new Date().toISOString();
    await route.fulfill({
      json: {
        ok: true,
        trial: { startedAt, endsAt: new Date(Date.now() + 14 * 86400000).toISOString(), plan: 'Professional' },
      },
    });
    await expect(page.getByText('Billing request stopped', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Starting trial…', exact: true })).toHaveCount(0);
    const trialStart = await page.evaluate(async () => {
      const modulePath = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
      return useXbarStore.getState().subscription.trialStart;
    });
    expect(trialStart).toBeUndefined();
    await expect(page.getByText('Professional trial started', { exact: true })).toHaveCount(0);
  });
}

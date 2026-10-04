import { expect, test, type Page } from '@playwright/test';

async function openReports(page: Page, tier = 'Starter', cloud = true) {
  await page.addInitScript(() => localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Cedar Ridge');
  await page.getByPlaceholder('Primary Ranch').fill('Cedar Ridge Ranch');
  await page.getByPlaceholder('Legal owner').fill('Example Owner');
  await page.getByPlaceholder('Owner entity').fill('Cedar Ridge');
  await page.getByPlaceholder('Barn A').fill('Main Barn');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.evaluate(
    async ({ tier, cloud }) => {
      const storePath = '/src/store/useXbarStore.ts';
      const cloudPath = '/src/store/useCloudStore.ts';
      const runtimePath = '/src/lib/xbarRuntime.ts';
      const { useXbarStore } = await import(storePath);
      const { useCloudStore } = await import(cloudPath);
      const { buildSubscriptionForTier } = await import(runtimePath);
      useXbarStore.setState({
        subscription: buildSubscriptionForTier(useXbarStore.getState().subscription, tier),
        currentRole: 'Admin',
      });
      if (cloud)
        useCloudStore.setState({
          workspaceId: '11111111-1111-4111-8111-111111111111',
          workspaceRole: 'Admin',
          session: { access_token: 'synthetic-test-token', user: { id: '22222222-2222-4222-8222-222222222222' } },
        });
      history.pushState({}, '', '/app/reports');
      dispatchEvent(new PopStateEvent('popstate'));
    },
    { tier, cloud },
  );
  await expect(page.getByRole('heading', { name: 'Report presentation', exact: true })).toBeVisible();
}

test('offer opens only on action, second attempt discounts once, dismissal preserves route and focus', async ({
  page,
}) => {
  const attempts: string[] = [];
  const declined = new Set<string>();
  await page.route('**/api/account/upgrade-offer', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'decline') {
      declined.add(body.attemptId);
      return route.fulfill({ json: { ok: true } });
    }
    if (!attempts.includes(body.attemptId)) attempts.push(body.attemptId);
    const discount = attempts.indexOf(body.attemptId) === 1 && declined.has(attempts[0]) ? 10 : 0;
    return route.fulfill({
      json: {
        ok: true,
        offer: {
          ...body,
          targetTier: 'Ranch Ops',
          currency: 'USD',
          regularAmountCents: 7900,
          firstPeriodAmountCents: discount ? 7110 : 7900,
          discountPercent: discount,
          checkoutAvailable: true,
        },
      },
    });
  });
  await openReports(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Customize your reports' });
  await trigger.click();
  const modal = page.getByRole('dialog', { name: 'Report presentation studio' });
  await expect(modal).toContainText('$79.00 per month');
  await expect(modal).not.toContainText('10% off');
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/reports$/);
  await expect(trigger).toBeFocused();
  await expect.poll(() => declined.size).toBe(1);
  await trigger.click();
  await expect(modal).toContainText('10% off your first billing period');
  await expect(modal).toContainText('$71.10 for the first month, then $79.00 per month');
  await modal.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect.poll(() => declined.size).toBe(2);
  await trigger.click();
  await expect(modal).toContainText('$79.00 per month');
  await expect(modal).not.toContainText('10% off');
  expect(attempts).toHaveLength(3);
});

test('unverified pricing offers comparison without a fake discount or payment action', async ({ page }) => {
  await page.route('**/api/account/upgrade-offer', (route) =>
    route.fulfill({ status: 503, json: { ok: false, message: 'Upgrade pricing is not configured.' } }),
  );
  await openReports(page);
  await page.getByRole('button', { name: 'Customize your reports' }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toContainText('Upgrade pricing is not configured.');
  await expect(modal.getByRole('button', { name: 'Review upgrade' })).toHaveCount(0);
  await expect(modal).not.toContainText('10%');
  await modal.getByRole('button', { name: 'Compare plans' }).click();
  await expect(page).toHaveURL(/\/billing\?plan=Ranch%20Ops$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('late quote cannot reopen a dismissed dialog or cross a workspace round trip', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/account/upgrade-offer', async (route) => {
    const body = route.request().postDataJSON();
    await held;
    return route.fulfill({
      json: {
        ok: true,
        offer: {
          ...body,
          targetTier: 'Ranch Ops',
          currency: 'USD',
          regularAmountCents: 7900,
          firstPeriodAmountCents: 7110,
          discountPercent: 10,
          checkoutAvailable: true,
        },
      },
    });
  });
  await openReports(page);
  await page.getByRole('button', { name: 'Customize your reports' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/store/useCloudStore.ts';
    const { useCloudStore } = await import(path);
    useCloudStore.setState({ workspaceId: '33333333-3333-4333-8333-333333333333' });
    useCloudStore.setState({ workspaceId: '11111111-1111-4111-8111-111111111111' });
  });
  release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Ranch Ops controls preserve contrast and Enterprise-only artwork control at phone width', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReports(page, 'Ranch Ops', false);
  await expect(page.getByLabel('Add an executive cover')).toBeVisible();
  await page.getByLabel('Add an executive cover').check();
  await expect(page.locator('.report-studio__preview')).toContainText('Executive cover + complete report');
  await page.getByLabel('Your ranch color').fill('#eeeeee');
  await expect(page.getByRole('status')).toContainText('Choose a darker color');
  await expect(page.getByLabel('Hide decorative XBAR artwork')).toHaveCount(0);
  await page.getByRole('button', { name: 'Explore ranch-first styling' }).click();
  await expect(page.getByRole('dialog')).toContainText('Included with Enterprise');
  await page.getByRole('button', { name: 'Not now' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('report-studio-mobile.png'), fullPage: true });
});

test('rapid reopen waits for a delayed decline and then receives the second-attempt offer', async ({ page }) => {
  let release!: () => void;
  const saveDecline = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  let declined = false;
  await page.route('**/api/account/upgrade-offer', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'decline') {
      await saveDecline;
      declined = true;
      return route.fulfill({ json: { ok: true } });
    }
    attempts += 1;
    const discount = attempts === 2 && declined;
    return route.fulfill({
      json: {
        ok: true,
        offer: {
          ...body,
          targetTier: 'Ranch Ops',
          currency: 'USD',
          regularAmountCents: 7900,
          firstPeriodAmountCents: discount ? 7110 : 7900,
          discountPercent: discount ? 10 : 0,
          checkoutAvailable: true,
        },
      },
    });
  });
  await openReports(page);
  const trigger = page.getByRole('button', { name: 'Customize your reports' });
  await trigger.click();
  await expect(page.getByRole('dialog')).toContainText('$79.00 per month');
  await page.getByRole('button', { name: 'Not now' }).click();
  await trigger.click();
  await expect(page.getByRole('dialog')).toContainText('Checking available pricing');
  expect(attempts).toBe(1);
  release();
  await expect(page.getByRole('dialog')).toContainText('10% off your first billing period');
  expect(attempts).toBe(2);
});

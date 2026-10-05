import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Synthetic Task Ranch');
  await page.getByPlaceholder('Primary Ranch').fill('Synthetic Task Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Test Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('tasks@example.test');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.evaluate(async () => {
    const storePath = '/src/store/useXbarStore.ts';
    const helpersPath = '/src/store/xbarStoreHelpers.ts';
    const { useXbarStore } = await import(storePath);
    const { createHorseRecord } = await import(helpersPath);
    const state = useXbarStore.getState();
    const horse = (id: string, name: string, segment: string) => ({
      ...createHorseRecord(
        {
          name,
          barnName: '',
          segment,
          sex: 'Filly',
          status: 'Pasture',
          owner: 'Example Owner',
          ownerEntity: 'Example Ranch',
          barn: 'Main',
          pasture: '',
        },
        state.workspaceProfile,
      ),
      id,
    });
    const lead = (id: string, name: string, nextFollowUp: string) => ({
      id,
      name,
      horseId: 'young',
      stage: 'New',
      channel: 'Referral',
      nextFollowUp,
      lastTouch: '2020-01-01',
      notes: '',
      savedListing: false,
      shareReady: false,
    });
    useXbarStore.setState({
      horses: [horse('young', 'Young Horse', 'Young Stock'), horse('mare', 'Mare Horse', 'Broodmare')],
      documents: [],
      ownershipRecords: [],
      expenseReceipts: [],
      salesLeads: [lead('future', 'Future Buyer', '2099-01-01'), lead('due', 'Due Buyer', '2020-01-01')],
    });
    history.pushState({}, '', '/app/today');
    dispatchEvent(new PopStateEvent('popstate'));
  });
}

test('snooze survives reload, restores and expires on its local day without claiming completion', async ({
  page,
}, info) => {
  await page.clock.install();
  await setup(page);
  const opener = page.getByRole('button', { name: 'Open task: Follow up with Due Buyer', exact: true });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Follow up with Due Buyer' });
  await expect(drawer.getByRole('button', { name: 'Mark Done' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('ranch-task-deferrals-desktop.png'), fullPage: true });
  await drawer.getByRole('button', { name: '3 days', exact: true }).click();
  await expect(opener).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /1 deferred · Show/ })).toBeVisible();
  await expect(opener).toHaveCount(0);
  await page.getByRole('button', { name: /1 deferred · Show/ }).click();
  await opener.click();
  await drawer.getByRole('button', { name: 'Dismiss today', exact: true }).click();
  await expect(opener).toHaveCount(0);
  await page.clock.fastForward(24 * 60 * 60 * 1000);
  await expect(opener).toBeVisible();
});

test('Today excludes future buyers and preserves selected group across reload and history', async ({ page }) => {
  await setup(page);
  await expect(page.getByText('Follow up with Future Buyer', { exact: true })).toHaveCount(0);
  await page.goto('/app/herd-groups');
  await page
    .locator('.xs-card')
    .filter({ has: page.getByRole('heading', { name: 'Young Stock', exact: true }) })
    .getByRole('button', { name: 'Care Tasks', exact: true })
    .click();
  await expect(page).toHaveURL(/segment=Young\+Stock/);
  await expect(page.getByText(/Finish ownership documents.*Mare Horse/i)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Clear group filter', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear group filter', exact: true }).click();
  await expect(page.getByText(/Finish ownership documents.*Mare Horse/i)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/segment=Young\+Stock/);
  await expect(page.getByText(/Finish ownership documents.*Mare Horse/i)).toHaveCount(0);
});

test('storage refusal leaves the task visible and reports no saved action', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('xbar-task-deferrals-v2:'))
        throw new DOMException('Synthetic storage refusal', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const opener = page.getByRole('button', { name: 'Open task: Follow up with Due Buyer', exact: true });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Follow up with Due Buyer' });
  await drawer.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await expect(drawer).toBeVisible();
  await expect(page.getByText('Task not deferred', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opener).toBeVisible();
});

test('long task text wraps on mobile and keyboard actions open the exact buyer', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(path);
    useXbarStore.setState({
      salesLeads: useXbarStore
        .getState()
        .salesLeads.map((lead: { id: string }) =>
          lead.id === 'due'
            ? { ...lead, notes: 'Long buyer notes must wrap without overlapping other task rows. '.repeat(12) }
            : lead,
        ),
    });
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
  const rows = await page.locator('.care-task-row').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    }),
  );
  rows.slice(1).forEach((row, index) => expect(row.top).toBeGreaterThanOrEqual(rows[index].bottom));
  await page.screenshot({ path: info.outputPath('ranch-task-deferrals-mobile-list.png'), fullPage: true });
  const opener = page.getByRole('button', { name: 'Open task: Follow up with Due Buyer', exact: true });
  await opener.focus();
  await opener.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Follow up with Due Buyer' });
  await expect(drawer).toBeVisible();
  await page.screenshot({ path: info.outputPath('ranch-task-deferrals-mobile-drawer.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await opener.press('Enter');
  await drawer.getByRole('button', { name: 'Open buyer follow-up', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/buyers\/due$/);
  await expect(page.locator('.xs-detailhead__name')).toHaveText('Due Buyer');
  await page.goBack();
  await expect(opener).toBeVisible();
});

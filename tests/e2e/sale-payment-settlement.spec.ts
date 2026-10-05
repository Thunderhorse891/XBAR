import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const width of [1440, 390]) {
  test(`sale receipts reconcile through close-out, reload and export at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('xbar-command-center-entry', 'true'));
    await page.goto('/app/setup');
    await page.getByPlaceholder('XBAR LLC').fill('Synthetic Settlement Review');
    await page.getByPlaceholder('Primary Ranch').fill('Synthetic Ranch');
    await page.getByPlaceholder('Legal owner').fill('Example Owner');
    await page.getByPlaceholder('Owner entity').fill('Synthetic Settlement Review');
    await page.getByPlaceholder('Barn A').fill('Main Barn');
    await page.getByPlaceholder('Pasture 1').fill('North Pasture');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/app$/);
    const today = await page.evaluate(async () => {
      const storePath = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(storePath);
      const state = useXbarStore.getState();
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      useXbarStore.setState({
        subscription: {
          ...state.subscription,
          tier: 'Ranch Ops',
          purchasedTier: 'Ranch Ops',
          billingState: 'Manual Billing',
        },
        horses: [
          {
            id: 'horse',
            name: 'Settlement Horse',
            costBasis: 10000,
            status: 'Sale Prep',
            owner: 'Example Owner',
            alerts: [],
            gallery: [],
            documentFacts: [],
            activity: [],
            documents: [],
            health: {},
            breeding: {},
            readiness: { score: 100 },
            sale: { askPrice: 25000, listingState: 'Market Ready' },
          },
        ],
        documents: [],
        ownershipRecords: [],
        expenseReceipts: [],
        salesLeads: [
          {
            id: 'won',
            horseId: 'horse',
            name: 'Synthetic Buyer',
            channel: 'Referral',
            lastTouch: day,
            stage: 'Closed',
            outcome: 'Won',
            offerStatus: 'Draft',
            offerAmount: 25000,
            depositStatus: 'Due',
            depositAmount: 5000,
            savedListing: false,
            shareReady: false,
          },
        ],
      });
      history.pushState({}, '', '/app/sales');
      dispatchEvent(new PopStateEvent('popstate'));
      return day;
    });
    await expect(page.getByLabel('Amount received (incl. deposit)')).toBeVisible();
    await expect(page.getByText('$25K still owed', { exact: true })).toBeVisible();
    await page.getByLabel('Amount received (incl. deposit)').fill('8000');
    await page.getByLabel('Received on').fill('2026-05-01');
    await page.getByRole('button', { name: 'Save lead changes', exact: true }).click();
    await page.reload();
    await expect(page.getByLabel('Amount received (incl. deposit)')).toHaveValue('8000');
    await expect(page.getByLabel('Received on')).toHaveValue('2026-05-01');
    await page.getByRole('button', { name: 'Paid in full', exact: true }).click();
    await expect(page.getByLabel('Received on')).toHaveValue(today);
    await page.getByRole('button', { name: 'Save lead changes', exact: true }).click();
    await page.reload();
    await expect(page.getByLabel('Amount received (incl. deposit)')).toHaveValue('25000');
    await page.screenshot({ path: info.outputPath(`settlement-${width}.png`), fullPage: true });
    await page.goto('/app/reports');
    await expect(page.getByText('Sale payments received', { exact: true })).toBeVisible();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export spreadsheet', exact: true }).click();
    const download = await downloadEvent;
    expect(await download.failure()).toBeNull();
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv).toContain('"Agreed closed-sale value","25000"');
    expect(csv).toContain('"Received sale payments (including applied deposits)","25000"');
    expect(csv).toContain('"Sale balances still owed","0"');
    await page.screenshot({ path: info.outputPath(`settlement-report-${width}.png`), fullPage: true });
  });
}

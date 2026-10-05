import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const width of [1440, 390]) {
  test(`report economics remain honest on screen and export at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('xbar-command-center-entry', 'true'));
    await page.goto('/app/setup');
    await page.getByPlaceholder('XBAR LLC').fill('Synthetic Financial Review');
    await page.getByPlaceholder('Primary Ranch').fill('Synthetic Review Ranch');
    await page.getByPlaceholder('Legal owner').fill('Example Owner');
    await page.getByPlaceholder('Owner entity').fill('Synthetic Financial Review');
    await page.getByPlaceholder('Barn A').fill('Main Barn');
    await page.getByPlaceholder('Pasture 1').fill('North Pasture');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.evaluate(async () => {
      const storePath = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(storePath);
      const state = useXbarStore.getState();
      const makeHorse = (id: string, name: string, costBasis: number) => ({
        id,
        name,
        costBasis,
        status: 'Sale Prep',
        owner: 'Example Owner',
        alerts: [],
        gallery: [],
        documentFacts: [],
        readiness: { score: 100 },
        sale: { askPrice: 20000, listingState: 'Market Ready' },
      });
      const today = new Date();
      const date = (offset: number) => {
        const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
        return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      };
      useXbarStore.setState({
        subscription: {
          ...state.subscription,
          tier: 'Ranch Ops',
          purchasedTier: 'Ranch Ops',
          billingState: 'Manual Billing',
        },
        horses: [makeHorse('unknown', 'Unknown Cost Horse', 0), makeHorse('sold', 'Sold Loss Horse', 10000)],
        documents: [],
        ownershipRecords: [],
        expenseReceipts: [
          { id: 'spent', horseId: 'sold', category: 'Feed', amount: 900, receiptDate: date(0) },
          { id: 'future', horseId: 'unknown', category: 'Feed', amount: 9000, receiptDate: date(1) },
        ],
        salesLeads: [
          { id: 'won', horseId: 'sold', name: 'Synthetic Buyer', stage: 'Closed', outcome: 'Won', offerAmount: 5000 },
        ],
      });
      history.pushState({}, '', '/app/reports');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    const unknown = page.getByRole('link', { name: 'Unknown Cost Horse, open profile', exact: true });
    await expect(unknown).toContainText('Unknown');
    await expect(unknown).toContainText('Cost records missing');
    await expect(unknown).not.toContainText('100%');
    const sold = page.getByRole('link', { name: 'Sold Loss Horse, open profile', exact: true });
    await expect(sold).toContainText('-$5,900');
    await expect(sold).toContainText('not cash received');
    await expect(sold).not.toContainText('$20,000');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export spreadsheet', exact: true }).click();
    const download = await downloadEvent;
    expect(await download.failure()).toBeNull();
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv).toContain('-5900');
    expect(csv).toContain('Unknown');
    expect(csv).toContain('not cash received');
    expect(csv).not.toContain('9000');
    await page.screenshot({ path: info.outputPath(`financial-truth-${width}.png`), fullPage: true });
    await page.evaluate(async () => {
      const storePath = '/src/store/useXbarStore.ts';
      const helperPath = '/src/store/xbarStoreHelpers.ts';
      const { useXbarStore } = await import(storePath);
      const { restorePersistedState } = await import(helperPath);
      const state = useXbarStore.getState();
      useXbarStore.setState(
        restorePersistedState({
          ...state,
          horses: [{ ...state.horses[0], costBasis: 10000 }],
          expenseReceipts: [
            { id: 'bad-date', horseId: 'unknown', category: 'Feed', amount: 9000, receiptDate: 'unreadable' },
          ],
          salesLeads: [
            {
              id: 'open',
              horseId: 'unknown',
              name: 'Synthetic Buyer',
              stage: 'Offer',
              offerStatus: 'Received',
              offerAmount: 12000,
            },
          ],
        }),
      );
      history.pushState({}, '', '/app/sales');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('button', { name: 'Counter at protected floor', exact: true })).toBeDisabled();
    await expect(page.getByText('Cost records incomplete', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`incomplete-cost-guard-${width}.png`), fullPage: true });
  });
}

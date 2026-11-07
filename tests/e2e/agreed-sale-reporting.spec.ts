import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function seedUnpaidAgreement(page: Page) {
  await page.addInitScript(() => localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Synthetic Agreed Sale Review');
  await page.getByPlaceholder('Primary Ranch').fill('Synthetic Ranch');
  await page.getByPlaceholder('Legal owner').fill('Example Owner');
  await page.getByPlaceholder('Owner entity').fill('Synthetic Agreed Sale Review');
  await page.getByPlaceholder('Barn A').fill('Main Barn');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.evaluate(async () => {
    const storePath = '/src/store/useXbarStore.ts';
    const helperPath = '/src/store/xbarStoreHelpers.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ storePath);
    const { createHorseRecord } = await import(/* @vite-ignore */ helperPath);
    const state = useXbarStore.getState();
    const horse = createHorseRecord(
      {
        name: 'Agreed Sale Horse',
        barnName: 'Agreement',
        sex: 'Mare',
        segment: 'Broodmare',
        status: 'Sale Prep',
        owner: 'Example Owner',
        ownerEntity: 'Synthetic Agreed Sale Review',
        barn: 'Main Barn',
        pasture: 'North Pasture',
      },
      state.workspaceProfile,
    );
    useXbarStore.setState({
      subscription: {
        ...state.subscription,
        tier: 'Ranch Ops',
        purchasedTier: 'Ranch Ops',
        billingState: 'Manual Billing',
      },
      horses: [{ ...horse, id: 'agreed-horse', costBasis: 10000, sale: { ...horse.sale, askPrice: 50000 } }],
      documents: [],
      ownershipRecords: [],
      expenseReceipts: [],
      salesLeads: [
        {
          id: 'unpaid-won',
          horseId: 'agreed-horse',
          name: 'Synthetic Buyer',
          channel: 'Referral',
          stage: 'Closed',
          outcome: 'Won',
          offerStatus: 'Draft',
          offerAmount: 25000,
          depositAmount: 5000,
          depositStatus: 'Due',
          lastTouch: '2026-05-01',
          offerUpdatedAt: '2026-05-01',
          savedListing: false,
          shareReady: false,
        },
      ],
    });
  });
}

async function assertDashboardAgreement(page: Page) {
  const moneyBand = page.locator('.xs-money');
  const estimated = moneyBand.getByRole('button', { name: /Estimated sale margin/ });
  const agreed = moneyBand.getByRole('button', { name: /Agreed sales/ });
  await expect(estimated).toContainText('$15K');
  await expect(agreed).toContainText('$25K');
  await expect(page.getByText('Payment collection is not tracked', { exact: false }).first()).toBeVisible();
  await expect(moneyBand).not.toContainText(/Profit banked|Collected from sales|Cash in from closed deals/i);
  return estimated;
}

for (const width of [390, 1440]) {
  test(`unpaid agreements stay truthful across Dashboard, Money, Reports and reload at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await seedUnpaidAgreement(page);
    const estimated = await assertDashboardAgreement(page);
    await page.screenshot({ path: info.outputPath(`ranch-agreed-dashboard-${width}.png`), fullPage: true });
    await estimated.click();
    await expect(page).toHaveURL(/\/financials(?:\?|$)/);
    const margin = page.locator('.fin-stat--hero');
    await expect(margin).toContainText('Estimated sale margin');
    await expect(margin).toContainText('$15,000');
    await expect(margin).toContainText('$25,000');
    await expect(page.getByText('Payment collection is not tracked', { exact: false }).first()).toBeVisible();
    await expect(margin).not.toContainText(/banked|collected/i);
    await page.reload();
    await expect(margin).toContainText('Estimated sale margin');
    await expect(margin).toContainText('$15,000');
    await page.screenshot({ path: info.outputPath(`ranch-agreed-money-${width}.png`), fullPage: true });

    await page.goto('/app/reports');
    const sold = page.getByRole('link', { name: /Agreed Sale Horse, open profile/i });
    await expect(sold).toContainText('$25,000');
    await expect(sold).toContainText('$15,000');
    await expect(sold).toContainText('not cash received');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export spreadsheet', exact: true }).click();
    const download = await downloadEvent;
    expect(await download.failure()).toBeNull();
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv).toContain('Agreed closed sale value (not cash received)');
    expect(csv).toContain('Estimated closed sale margin (before overhead)');
    expect(csv).toContain('Payment collection is not tracked');
    expect(csv).toContain('"25000","15000"');
    expect(csv).toContain('"Deposits held","0"');
    expect(csv).not.toMatch(/Profit banked|Collected from sales|25000 collected/i);
    await page.screenshot({ path: info.outputPath(`ranch-agreed-report-${width}.png`), fullPage: true });

    await page.goto('/app');
    await page.reload();
    await assertDashboardAgreement(page);
    const lead = await page.evaluate(async () => {
      const storePath = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(/* @vite-ignore */ storePath);
      return useXbarStore.getState().salesLeads[0];
    });
    expect(lead.offerAmount).toBe(25000);
    expect(lead.offerStatus).toBe('Draft');
    expect(lead.depositStatus).toBe('Due');
    expect(lead).not.toHaveProperty('amountReceived');
    expect(lead).not.toHaveProperty('amountReceivedOn');
  });

  test(`unknown prices remain visible beside known subtotals without rewriting records at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await seedUnpaidAgreement(page);
    await page.evaluate(async () => {
      const storePath = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(/* @vite-ignore */ storePath);
      const state = useXbarStore.getState();
      const horse = state.horses[0];
      const lead = { ...state.salesLeads[0], stage: 'Offer', outcome: undefined, offerStatus: 'Accepted' };
      useXbarStore.setState({
        horses: [
          { ...horse, id: 'valid-offer', name: 'Valid Offer Horse', sale: { ...horse.sale, askPrice: 30000 } },
          { ...horse, id: 'unknown-offer', name: 'Unknown Offer Horse', sale: { ...horse.sale, askPrice: 50000 } },
          {
            ...horse,
            id: 'valid-held',
            name: 'Valid Held Horse',
            costBasis: 4000,
            sale: { ...horse.sale, askPrice: 12000 },
          },
          { ...horse, id: 'unknown-held', name: 'Unknown Held Horse', sale: { ...horse.sale, askPrice: '70000' } },
        ],
        salesLeads: [
          { ...lead, id: 'valid-lead', horseId: 'valid-offer', offerAmount: 20000 },
          { ...lead, id: 'unknown-lead', horseId: 'unknown-offer', offerAmount: 25000, counterOfferAmount: '26000' },
        ],
      });
    });
    await page.getByRole('button', { name: /Estimated sale margin/ }).click();
    await expect(page).toHaveURL(/\/financials(?:\?|$)/);
    const upside = page.locator('.fin-stat').filter({ hasText: 'Upside in the herd' });
    await expect(upside).toContainText('$18,000');
    await expect(upside).toContainText('$32,000 projected value');
    await expect(upside).toContainText('Partial: 2 prices unknown');
    await page.reload();
    await expect(upside).toContainText('Partial: 2 prices unknown');
    await expect(upside).toContainText('$32,000 projected value');
    await page.screenshot({ path: info.outputPath(`ranch-unknown-prices-money-${width}.png`), fullPage: true });

    await page.goto('/app/reports');
    const summary = page.getByLabel('Money summary', { exact: true });
    await expect(summary).toContainText('$92K');
    await expect(summary).toContainText('Known-value subtotals');
    await expect(summary).toContainText('1 listed prices unknown');
    const offers = page.locator('.ops-metric-card').filter({ hasText: 'Open offers' });
    await expect(offers).toContainText('$20K');
    await expect(offers).toContainText('Partial: 1 offer prices unknown');
    await page.reload();
    await expect(summary).toContainText('Known-value subtotals');
    await expect(offers).toContainText('Partial: 1 offer prices unknown');
    await page.screenshot({ path: info.outputPath(`ranch-unknown-prices-report-${width}.png`), fullPage: true });

    const raw = await page.evaluate(async () => {
      const storePath = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(/* @vite-ignore */ storePath);
      const state = useXbarStore.getState();
      return {
        counter: state.salesLeads.find((lead: { id: string }) => lead.id === 'unknown-lead')?.counterOfferAmount,
        originalOffer: state.salesLeads.find((lead: { id: string }) => lead.id === 'unknown-lead')?.offerAmount,
        ask: state.horses.find((horse: { id: string }) => horse.id === 'unknown-held')?.sale.askPrice,
      };
    });
    expect(raw).toEqual({ counter: '26000', originalOffer: 25000, ask: '70000' });
  });
}

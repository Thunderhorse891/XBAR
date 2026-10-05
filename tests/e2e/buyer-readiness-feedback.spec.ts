import { expect, test, type Page } from '@playwright/test';

async function setupBuyer(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Buyer Feedback');
  await page.getByPlaceholder('Primary Ranch').fill('Buyer Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Test Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('buyer-feedback@example.test');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  const id = await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    const horse = useXbarStore.getState().addHorse({
      name: 'Feedback horse',
      barnName: 'Feedback',
      segment: 'Sale Prospect',
      sex: 'Mare',
      status: 'Pasture',
      owner: 'Test',
      ownerEntity: 'Test',
      barn: 'West',
      pasture: '',
    });
    if (!horse.ok || !horse.id) throw new Error('Synthetic horse creation failed');
    const lead = useXbarStore
      .getState()
      .createSalesLead({ name: 'Synthetic buyer', horseId: horse.id, channel: 'Referral', shareReady: true });
    if (!lead.ok || !lead.id) throw new Error('Synthetic buyer creation failed');
    return lead.id as string;
  });
  await page.goto(`/buyers/${id}`);
  return id;
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`buyer readiness is distinct from access and repeated clicks do not duplicate history at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const id = await setupBuyer(page);
    await expect(page.getByText('Sharing readiness is an internal note.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Mark not ready', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Sharing readiness updated' })).toContainText(
      'Existing links and downloaded packets are unchanged',
    );
    await expect(page.getByRole('button', { name: 'Mark not ready', exact: true })).toBeDisabled();
    const outcome = await page.evaluate(async (leadId) => {
      const path = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(/* @vite-ignore */ path);
      const state = useXbarStore.getState();
      return {
        ready: state.salesLeads.find((lead: { id: string }) => lead.id === leadId)?.shareReady,
        events: state.buyerRoomEvents.filter((event: { note?: string }) =>
          event.note?.includes('not ready for sharing'),
        ).length,
      };
    }, id);
    expect(outcome).toEqual({ ready: false, events: 1 });
    await page.screenshot({ path: testInfo.outputPath(`ranch-buyer-readiness-${viewport.width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Manage listing links' }).click();
    await expect(page).toHaveURL(/\/shared-access$/);
  });
}

test('refused buyer readiness update stays inline and creates no buyer event', async ({ page }) => {
  await setupBuyer(page);
  await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    useXbarStore.setState({ updateSalesLead: () => ({ ok: false, message: 'Sales permission changed.' }) });
  });
  await page.getByRole('button', { name: 'Mark not ready', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Sales permission changed.');
  const count = await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    return useXbarStore.getState().buyerRoomEvents.length;
  });
  expect(count).toBe(0);
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
});

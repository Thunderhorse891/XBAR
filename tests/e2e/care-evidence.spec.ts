import { expect, test, type Page } from '@playwright/test';

async function bootstrapWorkspace(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));

  // The application router lives under /app (marketing owns the site root).
  await page.goto('/app/setup');

  const setupHeading = page.getByRole('heading', { name: 'Configure Workspace' });
  const setupVisible = await setupHeading.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!setupVisible) {
    await page.goto('/app/setup');
  }
  await expect(setupHeading).toBeVisible({ timeout: 10_000 });

  // Fill by placeholder — stable against label theming.
  await page.getByPlaceholder('XBAR LLC').fill('XBAR Holdings');
  await page.getByPlaceholder('Primary Ranch').fill('Thunder Horse Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Erin Wyrick');
  await page.getByPlaceholder('ops@yourranch.com').fill('ops@xbar.test');
  await page.getByPlaceholder('Legal owner').fill('Thunder Horse Ranch');
  await page.getByPlaceholder('Owner entity').fill('Thunder Horse Ranch LLC');
  await page.getByPlaceholder('Barn A').fill('Barn A');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });
  // Fresh workspace lands on the plain-language getting-started dashboard (no seeded records).
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible({
    timeout: 15_000,
  });
}

// Seed one real horse through the global Create > Add Horse flow (persists to the store).
async function seedHorse(page: Page, name = 'Test Prospect') {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill(name);
  await drawer.getByLabel('Sex', { exact: true }).selectOption('Mare');
  await drawer.getByLabel('Segment', { exact: true }).selectOption('Sale Prospect');
  await drawer.getByRole('button', { name: 'Add Horse' }).click();
  await expect(page).toHaveURL(/\/horses\//, { timeout: 15_000 });
}

test.use({ timezoneId: 'America/Los_Angeles' });
for (const careType of ['Deworming', 'Dental'] as const) {
  test(`completed ${careType} persists and changes care and sale-readiness together`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await bootstrapWorkspace(page);
    await seedHorse(page, 'Care Evidence Horse');
    const horseId = new URL(page.url()).pathname.split('/').at(-1)!;
    await page.goto(`/app/medical?horse=${horseId}&type=${careType}`);
    await expect(page.getByLabel('Event date', { exact: true })).toHaveValue('2026-10-02');
    await expect(page.getByRole('combobox', { name: 'Event type', exact: true })).toHaveValue(careType);
    await page.getByLabel('Event title', { exact: true }).fill(`${careType} completed`);
    await page.getByLabel('Care note', { exact: true }).fill('Care administered, synthetic acceptance test.');
    await page.getByRole('button', { name: 'Save care event', exact: true }).click();
    await expect(page.getByText('Medical event added', { exact: true })).toBeVisible();
    await page.reload();
    const result = await page.evaluate(
      async ({ horseId, careType }) => {
        const storePath = '/src/store/useXbarStore.ts';
        const carePath = '/src/lib/dashboardOps.ts';
        const scorePath = '/src/lib/saleReadinessScore.ts';
        const { useXbarStore } = await import(/* @vite-ignore */ storePath);
        const { buildCareBoardRows } = await import(/* @vite-ignore */ carePath);
        const { buildSaleReadinessScore } = await import(/* @vite-ignore */ scorePath);
        const horse = useXbarStore.getState().horses.find((horse: { id: string }) => horse.id === horseId);
        const key = careType === 'Dental' ? 'dental' : 'wormer';
        return {
          completion: horse.medicalTimeline[0].completionState,
          status: buildCareBoardRows([horse], [], [])[0].signals.find((signal: { key: string }) => signal.key === key)
            .status,
          earned: buildSaleReadinessScore({ horse, documents: [], receipts: [] }).components.find(
            (component: { key: string }) => component.key === 'care',
          ).earned,
        };
      },
      { horseId, careType },
    );
    expect(result).toEqual({ completion: 'completed', status: 'clear', earned: 7.5 });
  });
}

test('planned care remains due after the day passes and clears only after operator confirmation', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Planned Care Horse');
  const horseId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.goto(`/app/medical?horse=${horseId}&type=Deworming`);
  await page.getByLabel('Event date', { exact: true }).fill('2026-10-03');
  await page.getByLabel('Care note', { exact: true }).fill('Planned appointment, not administered.');
  await page.getByRole('button', { name: 'Save care event', exact: true }).click();
  await expect(page.getByText(/Future care cannot be completed/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Care status', exact: true }).selectOption('planned');
  await page.getByRole('button', { name: 'Save care event', exact: true }).click();
  await expect(page.getByText('Medical event added', { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-10-05T02:00:00Z'));
  await page.reload();
  const status = () =>
    page.evaluate(async () => {
      const storePath = '/src/store/useXbarStore.ts';
      const carePath = '/src/lib/dashboardOps.ts';
      const { useXbarStore } = await import(/* @vite-ignore */ storePath);
      const { buildCareBoardRows } = await import(/* @vite-ignore */ carePath);
      return buildCareBoardRows(useXbarStore.getState().horses, [], [])[0].signals.find(
        (signal: { key: string }) => signal.key === 'wormer',
      ).status;
    });
  expect(await status()).toBe('due');
  await page.getByRole('button', { name: 'Confirm care completed', exact: true }).click();
  await expect(page.getByText('Care confirmed completed', { exact: true })).toBeVisible();
  await page.reload();
  expect(await status()).toBe('clear');
});

test('dedicated care form warns instead of confirming a refused device save', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Refused Care Horse');
  const horseId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.goto(`/app/medical?horse=${horseId}&type=Deworming`);
  await page.getByLabel('Event title', { exact: true }).fill('Refused deworming fixture');
  await page.getByLabel('Care note', { exact: true }).fill('Synthetic persistence refusal.');
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      if (this.name === 'xbar-workspace' && mode === 'readwrite') {
        throw new DOMException('Synthetic device write refusal', 'QuotaExceededError');
      }
      return transaction.call(this, stores, mode, options);
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'xbar-live-workspace') throw new DOMException('Synthetic fallback refusal', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Save care event', exact: true }).click();
  await expect(page.getByText('Device save not confirmed', { exact: true })).toBeVisible();
  await expect(page.getByText('Medical event added', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Keep XBAR open and check device storage/)).toBeVisible();
  await expect(page.getByLabel('Care note', { exact: true })).toHaveValue('');
  const count = () =>
    page.evaluate(async (id) => {
      const storePath = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(/* @vite-ignore */ storePath);
      return useXbarStore
        .getState()
        .horses.find((horse: { id: string }) => horse.id === id)
        ?.medicalTimeline.filter((event: { title: string }) => event.title === 'Refused deworming fixture').length;
    }, horseId);
  expect(await count()).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save care event', exact: true })).toBeVisible();
  expect(await count()).toBe(0);
});

import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Workflow Test');
  await page.getByPlaceholder('Primary Ranch').fill('Workflow Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Test Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('workflow@example.test');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function addHorse(page: Page, name = 'Young Test Horse', segment = 'Young Stock') {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill(name);
  await drawer.getByLabel('Segment').selectOption(segment);
  await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
  await expect(page).toHaveURL(/\/horses\//);
  return page.url();
}

test('equipment creation asks for details and opens the correct editable asset', async ({ page }) => {
  await setup(page);
  await page.goto('/equipment');
  await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    useXbarStore.getState().addRanchAsset({ name: 'Existing tractor', category: 'Equipment', location: 'East Barn' });
  });
  await page.getByRole('button', { name: 'Add Equipment', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Add Equipment' });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('e.g. Stock trailer (24ft)').fill('Trailer 24');
  await drawer.getByLabel('Category').selectOption('Transport');
  await drawer.getByLabel('Location').fill('West Barn');
  await drawer.getByRole('button', { name: 'Add Equipment', exact: true }).click();
  await expect(page).toHaveURL(/\/assets\?asset=/);
  const assetId = new URL(page.url()).searchParams.get('asset')!;
  await expect(page.getByRole('combobox', { name: 'Asset', exact: true })).toHaveValue(assetId);
  await expect(page.getByRole('textbox', { name: 'Location', exact: true }).first()).toHaveValue('West Barn');
  await page.getByRole('textbox', { name: 'Next service', exact: true }).fill('2026-12-01');
  await page.getByRole('button', { name: 'Save asset changes' }).click();
  await expect(page.getByText('Asset updated', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Next service', exact: true })).toHaveValue('2026-12-01');
});

test('profile upload and packet actions keep the selected horse', async ({ page }) => {
  await setup(page);
  const profile = await addHorse(page);
  const id = new URL(profile).pathname.split('/').at(-1)!;
  await page.getByRole('button', { name: 'Upload Doc', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`horse=${id}.*upload=1`));
  await expect(page.getByText('Documents for YOUNG TEST HORSE and unassigned uploads')).toBeVisible();
  await page.goto(profile);
  await page.getByRole('button', { name: 'Build Sale Packet', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`sale-packets\\?horse=${id}`));
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('Open Group keeps Young Stock filter across reload and excludes other groups', async ({ page }, testInfo) => {
  await setup(page);
  await addHorse(page);
  await addHorse(page, 'Other Test Horse', 'Broodmare');
  await page.goto('/herd-groups');
  await page
    .locator('.xs-card')
    .filter({ has: page.getByRole('heading', { name: 'Young Stock', exact: true }) })
    .getByRole('button', { name: 'Open Group', exact: true })
    .click();
  await expect(page).toHaveURL(/segment=Young\+Stock/);
  await expect(page.getByRole('tab', { name: 'Young Stock', exact: true })).toBeVisible();
  await expect(page.locator('.horse-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.horse-card')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('ranch-young-stock-filter.png'), fullPage: true });
});

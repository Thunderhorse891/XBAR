import { expect, test, type Page } from '@playwright/test';

async function bootstrapWorkspace(page: Page) {
  await page.addInitScript(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      await Promise.all(
        databases
          .map((database) => database.name)
          .filter((name): name is string => Boolean(name))
          .map(
            (name) =>
              new Promise<void>((resolve) => {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
              }),
          ),
      );
    }
  });

  await page.goto('/setup');

  const setupHeading = page.getByRole('heading', { name: 'Build your ranch workspace' });
  const openBrowserWorkspace = page.getByRole('button', { name: 'Open browser workspace' });
  const setupVisible = await setupHeading.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!setupVisible) {
    const browserEntryVisible = await openBrowserWorkspace.isVisible({ timeout: 2_000 }).catch(() => false);
    if (browserEntryVisible) {
      await openBrowserWorkspace.click();
    } else {
      await page.goto('/#/setup');
    }
  }
  await expect(setupHeading).toBeVisible({ timeout: 10_000 });

  await page.getByLabel('Business name').fill('XBAR Holdings');
  await page.getByLabel('Ranch name').fill('Thunder Horse Ranch');
  await page.getByLabel('Ranch manager').fill('Erin Wyrick');
  await page.getByLabel('Ops email').fill('ops@xbar.test');
  await page.getByLabel('Default owner').fill('Thunder Horse Ranch');
  await page.getByLabel('Owner entity').fill('Thunder Horse Ranch LLC');
  await page.getByLabel('Default barn').fill('Barn A');
  await page.getByLabel('Default pasture').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'XBAR Operations Console' })).toBeVisible({ timeout: 15_000 });
}

test('creates a workspace and lands on the operations console', async ({ page }) => {
  await bootstrapWorkspace(page);
  await expect(page.getByRole('heading', { name: /at risk/ })).toBeVisible();
  await expect(page.getByText('Needs a decision today')).toBeVisible();
  await expect(page.locator('.xs-ribbon')).toBeVisible();
  await expect(page.getByText('XBAR Intelligence')).toBeVisible();
});

test('global Create opens a real create drawer with fields', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Animal' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Animal' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Name', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Add Animal' })).toBeVisible();
});

test('clicking a task opens the task drawer; revenue blocker launches the resolve flow', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.locator('.xs-workmini__row').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Resolve blocker' }).first().click();
  const wizard = page.getByRole('dialog', { name: 'Resolve Blocker' });
  await expect(wizard).toBeVisible();
  await expect(wizard.getByText('Health certificate expiration date missing')).toBeVisible();
  await wizard.getByRole('button', { name: 'Continue' }).click();
  await expect(wizard.getByText('Add the missing field')).toBeVisible();
});

test('animal profile opens with tabs', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.locator('.xs-signal', { hasText: 'Medical hold' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.xs-dtab', { hasText: /^Sale Readiness$/ })).toBeVisible();
  await drawer.locator('.xs-dtab', { hasText: /^Health$/ }).click();
  await expect(drawer.getByText('Health certificate')).toBeVisible();
});

test('sale packet studio is a stepper wizard', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Sale Packet Studio', exact: true }).click();
  await expect(page.locator('.xs-stepper')).toBeVisible();
  await expect(page.locator('.xs-select')).toBeVisible(); // step 1: animal select
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Choose packet type')).toBeVisible(); // step 2 content
});

test('buyer deal room is a master-detail workspace', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Buyer Deal Rooms', exact: true }).click();
  await page.locator('.xs-mdrow', { hasText: 'Cedar Hollow Equine' }).click();
  await expect(page.locator('.xs-detailhead__name')).toHaveText('Cedar Hollow Equine');
  await expect(page.getByRole('button', { name: 'Prepare Release' })).toBeVisible();
});

test('documents vault opens a document drawer', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Documents Vault', exact: true }).click();
  await page.locator('.xs-table tbody tr').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Mark Buyer-Safe' })).toBeVisible();
});

test('pasture location opens a detail drawer', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Pastures & Locations', exact: true }).click();
  await page.locator('.xs-grid-2 .xs-card').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Animals currently here')).toBeVisible();
});

test('animals roster opens a full animal profile object page with tabs', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Animals', exact: true }).click();
  await expect(page.locator('.xs-table tbody tr').first()).toBeVisible();
  await page.locator('.xs-table tbody tr').first().click();
  await expect(page).toHaveURL(/\/animals\//);
  await expect(page.locator('.xs-objhead__name')).toBeVisible();
  await page.locator('.xs-tabbar__tab', { hasText: 'Sale Readiness' }).click();
  await expect(page.getByText('Buyer-safe proof')).toBeVisible();
});

test('sales pipeline renders a kanban board', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Sales Pipeline', exact: true }).click();
  await expect(page.locator('.xs-kanban')).toBeVisible();
  await expect(page.locator('.xs-kcol').first()).toBeVisible();
});

test('plans page shows plan cards', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('button', { name: 'Upgrade' }).click();
  await expect(page.getByRole('heading', { name: 'Plans & Upgrade' })).toBeVisible();
  await expect(page.locator('.xs-plancard')).toHaveCount(5);
});

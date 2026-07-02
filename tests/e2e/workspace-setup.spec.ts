import { expect, test, type Page } from '@playwright/test';

async function bootstrapWorkspace(page: Page) {
  await page.addInitScript(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('xbar-command-center-entry', 'true');
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

  const setupHeading = page.getByRole('heading', { name: 'Configure Workspace' });
  const setupVisible = await setupHeading.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!setupVisible) {
    await page.goto('/#/setup');
  }
  await expect(setupHeading).toBeVisible({ timeout: 10_000 });

  // Fill by placeholder — stable against label theming.
  await page.getByPlaceholder('XBAR LLC').fill('XBAR Holdings');
  await page.getByPlaceholder('Primary Ranch').fill('Thunder Horse Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Erin Wyrick');
  await page.getByPlaceholder('ops@xbar.com').fill('ops@xbar.test');
  await page.getByPlaceholder('Legal owner').fill('Thunder Horse Ranch');
  await page.getByPlaceholder('Owner entity').fill('Thunder Horse Ranch LLC');
  await page.getByPlaceholder('Barn A').fill('Barn A');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  // Fresh workspace lands on the plain-language getting-started dashboard (no seeded records).
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible({ timeout: 15_000 });
}

// Seed one real horse through the global Create → Add Animal flow (persists to the store).
async function seedAnimal(page: Page, name = 'Test Prospect') {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Animal' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Animal' });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill(name);
  await drawer.getByRole('button', { name: 'Add Animal' }).click();
  await expect(page).toHaveURL(/\/animals\//, { timeout: 15_000 });
}

test('creates a workspace and lands on the getting-started dashboard', async ({ page }) => {
  await bootstrapWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible();
  await expect(page.locator('.xs-ribbon')).toBeVisible();
  await expect(page.getByText('Smart Help')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add your first horse' })).toBeVisible();
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

test('a seeded horse produces care tasks and a task drawer', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedAnimal(page, 'Task Horse');
  await page.getByRole('link', { name: 'Care Tasks', exact: true }).click();
  await page.locator('.xs-task').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Open linked record' })).toBeVisible();
});

test('horses roster shows an empty state until a horse is added', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Horses', exact: true }).click();
  await expect(page.getByText('No horses yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add first horse' })).toBeVisible();
});

test('sale documents is a stepper wizard once a horse exists', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedAnimal(page, 'Packet Horse');
  await page.getByRole('link', { name: 'Sale documents', exact: true }).click();
  await expect(page.locator('.xs-stepper')).toBeVisible();
  await expect(page.locator('.xs-select')).toBeVisible(); // step 1: animal select
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Choose document set')).toBeVisible(); // step 2 content
});

test('buyer follow-up shows an empty state on a fresh workspace', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Buyer follow-up', exact: true }).click();
  await expect(page.getByText('No buyers yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare sale documents' })).toBeVisible();
});

test('paperwork shows an empty state on a fresh workspace', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Paperwork', exact: true }).click();
  await expect(page.getByText('No paperwork yet')).toBeVisible();
});

test('pasture location opens a detail drawer', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Pastures', exact: true }).click();
  await page.locator('.xs-grid-2 .xs-card').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Animals currently here')).toBeVisible();
});

test('a seeded horse opens a full profile object page with tabs', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedAnimal(page, 'Roster Prospect');
  await page.getByRole('link', { name: 'Horses', exact: true }).click();
  await expect(page.locator('.xs-table tbody tr').first()).toBeVisible();
  await page.locator('.xs-table tbody tr').first().click();
  await expect(page).toHaveURL(/\/animals\//);
  await expect(page.locator('.xs-objhead__name')).toHaveText(/roster prospect/i);
  await page.locator('.xs-tabbar__tab', { hasText: 'Ready to Sell' }).click();
  await expect(page.getByText('Ready to share with buyers')).toBeVisible();
});

test('sales renders a kanban board', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Sales', exact: true }).click();
  await expect(page.locator('.xs-kanban')).toBeVisible();
  await expect(page.locator('.xs-kcol').first()).toBeVisible();
});

test('plans page shows plan cards', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('button', { name: 'Plan' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a plan' })).toBeVisible();
  await expect(page.locator('.xs-plancard')).toHaveCount(4);
});

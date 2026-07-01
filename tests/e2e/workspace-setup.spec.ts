import { expect, test, type Page } from '@playwright/test';

async function clearBrowserWorkspace(page: Page) {
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
}

async function bootstrapWorkspace(page: Page) {
  await clearBrowserWorkspace(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('xbar-command-center-entry', 'true');
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
  // Fresh workspace lands on the data-driven getting-started console (no seeded records).
  await expect(page.getByRole('heading', { name: 'Set up your ranch operating system.' })).toBeVisible({ timeout: 15_000 });
}

// Seed one real animal through the global Create → Add Animal flow (persists to the store).
async function seedAnimal(page: Page, name = 'Test Prospect') {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Animal' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Animal' });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill(name);
  await drawer.getByRole('button', { name: 'Add Animal' }).click();
  await expect(page).toHaveURL(/\/animals\//, { timeout: 15_000 });
}

test('creates a workspace and lands on the getting-started console', async ({ page }) => {
  await bootstrapWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Set up your ranch operating system.' })).toBeVisible();
  await expect(page.locator('.xs-ribbon')).toBeVisible();
  await expect(page.getByText('XBAR Intelligence')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add your first animal' })).toBeVisible();
});

test('fresh public root opens login before workspace setup', async ({ page }) => {
  await clearBrowserWorkspace(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toBeHidden();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toBeVisible({ timeout: 10_000 });
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

test('work queue task opens the task drawer; revenue blocker launches the resolve flow', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: "Today's Work", exact: true }).click();
  await page.locator('.xs-task').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Resolve Blocker' }).click();

  const wizard = page.getByRole('dialog', { name: 'Resolve Blocker' });
  await expect(wizard).toBeVisible();
  await expect(wizard.getByText('Health certificate expiration date missing')).toBeVisible();
  await wizard.getByRole('button', { name: 'Continue' }).click();
  await expect(wizard.getByText('Add the missing field')).toBeVisible();
});

test('animals roster shows an empty state until an animal is added', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Animals', exact: true }).click();
  await expect(page.getByText('No animals yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add first animal' })).toBeVisible();
});

test('sale packet builder is a stepper wizard', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Sale Packet Builder', exact: true }).click();
  await expect(page.locator('.xs-stepper')).toBeVisible();
  await expect(page.locator('.xs-select')).toBeVisible(); // step 1: animal select
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Choose packet type')).toBeVisible(); // step 2 content
});

test('buyer folder is a master-detail workspace', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Buyer Folders', exact: true }).click();
  await page.locator('.xs-mdrow', { hasText: 'Cedar Hollow Equine' }).click();
  await expect(page.locator('.xs-detailhead__name')).toHaveText('Cedar Hollow Equine');
  await expect(page.getByRole('button', { name: 'Prepare Release' })).toBeVisible();
});

test('documents opens a document drawer', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.locator('.xs-table tbody tr').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Share With Buyer' })).toBeVisible();
});

test('pasture location opens a detail drawer', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Pastures & Locations', exact: true }).click();
  await page.locator('.xs-grid-2 .xs-card').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Animals currently here')).toBeVisible();
});

test('a seeded animal opens a full animal profile object page with tabs', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedAnimal(page, 'Roster Prospect');
  await page.getByRole('link', { name: 'Animals', exact: true }).click();
  await expect(page.locator('.xs-table tbody tr').first()).toBeVisible();
  await page.locator('.xs-table tbody tr').first().click();
  await expect(page).toHaveURL(/\/animals\//);
  await expect(page.locator('.xs-objhead__name')).toHaveText(/roster prospect/i);
  await page.locator('.xs-tabbar__tab', { hasText: 'Sale Readiness' }).click();
  await expect(page.getByText('Share With Buyer')).toBeVisible();
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

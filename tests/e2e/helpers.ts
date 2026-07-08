import { expect, type Page } from '@playwright/test';

export async function bootstrapWorkspace(page: Page) {
  await page.addInitScript(async () => {
    // Init scripts re-run on every document load — only wipe storage on the
    // first load so reload-based persistence assertions see real state.
    if (window.localStorage.getItem('xbar-e2e-bootstrapped') === 'true') return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('xbar-e2e-bootstrapped', 'true');
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
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible({
    timeout: 15_000,
  });
}

// Seed one real horse through the global Create > Add Horse flow (persists to the store).
export async function seedHorse(page: Page, name = 'Test Prospect') {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill(name);
  await drawer.getByRole('button', { name: 'Add Horse' }).click();
  await expect(page).toHaveURL(/\/horses\//, { timeout: 15_000 });
}

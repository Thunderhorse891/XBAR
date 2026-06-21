import { expect, test } from '@playwright/test';

test('creates a fresh workspace and lands on the operations dashboard', async ({ page }) => {
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
  await page.getByLabel('Ranch name').fill('Blue River Ranch');
  await page.getByLabel('Ranch manager').fill('Erin Wyrick');
  await page.getByLabel('Ops email').fill('ops@xbar.test');
  await page.getByLabel('Default owner').fill('Blue River Ranch');
  await page.getByLabel('Owner entity').fill('Blue River Ranch LLC');
  await page.getByLabel('Default barn').fill('Barn A');
  await page.getByLabel('Default pasture').fill('North Pasture');

  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Add your first horse.', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[aria-label="Empty workspace counters"]')).toContainText('Horses', { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Create the first horse record' })).toBeVisible({ timeout: 15_000 });
});

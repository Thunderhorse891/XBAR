import { expect, test } from '@playwright/test';

/**
 * Regression test for P0-01: opening a second page/tab must never overwrite
 * a real workspace with the empty seed state. Hydration of async IndexedDB
 * storage must complete before any writes are allowed.
 */
test('workspace persists after navigating to a second page', async ({ page, context }) => {
  // Start fresh
  await page.addInitScript(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      await Promise.all(
        databases
          .map((db) => db.name)
          .filter((name): name is string => Boolean(name))
          .map(
            (name) =>
              new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(name);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              }),
          ),
      );
    }
  });

  // Create a workspace
  await page.goto('/setup');
  const setupHeading = page.getByRole('heading', { name: 'Build the ranch workspace around real records.' });
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

  await page.getByLabel('Business name').fill('Persistence Ranch');
  await page.getByLabel('Ranch name').fill('Oak Creek Ranch');
  await page.getByLabel('Ranch manager').fill('Test User');
  await page.getByLabel('Ops email').fill('test@xbar.test');
  await page.getByLabel('Default owner').fill('Oak Creek Ranch');
  await page.getByLabel('Owner entity').fill('Oak Creek Ranch LLC');
  await page.getByLabel('Default barn').fill('Barn A');
  await page.getByLabel('Default pasture').fill('South Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  // Confirm we are on the dashboard with the workspace data
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /Ranch desk/, exact: false })).toBeVisible({ timeout: 10_000 });

  // Open a second page in the same browser context — this is the regression trigger
  const page2 = await context.newPage();
  await page2.goto('/');
  // The second page must reach the dashboard (not redirect to /setup)
  await expect(page2.getByRole('heading', { name: /Ranch desk/, exact: false })).toBeVisible({ timeout: 15_000 });

  // Return to the first page and confirm workspace data is intact
  await page.bringToFront();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Ranch desk/, exact: false })).toBeVisible({ timeout: 15_000 });

  await page2.close();
});

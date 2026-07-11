import { expect, test } from '@playwright/test';

/**
 * Regression test for P0-01: opening a second page must never overwrite a
 * real workspace with the empty seed state. The hydration write-guard in
 * workspaceStorage ensures pre-hydration setItem calls are dropped.
 */
test('workspace data survives opening a second page', async ({ page, context }) => {
  // Start with a completely empty browser state.
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

  // Create a workspace.
  await page.goto('/setup');
  const setupHeading = page.getByRole('heading', { name: 'Build your ranch workspace' });
  const openBrowserWorkspace = page.getByRole('button', { name: 'Open browser workspace' });
  const setupVisible = await setupHeading.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!setupVisible) {
    const browserEntryVisible = await openBrowserWorkspace.isVisible({ timeout: 2_000 }).catch(() => false);
    if (browserEntryVisible) await openBrowserWorkspace.click();
    else await page.goto('/#/setup');
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

  // Confirm the workspace is active on page 1.
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /One trusted record/i })).toBeVisible({ timeout: 10_000 });

  // Open a second page in the same browser context — the regression trigger.
  const page2 = await context.newPage();
  await page2.goto('/');

  // The second page must reach the dashboard, NOT redirect to /setup.
  await expect(page2.getByRole('heading', { name: /One trusted record/i })).toBeVisible({ timeout: 15_000 });

  // Reload the first page and confirm workspace is still intact.
  await page.bringToFront();
  await page.reload();
  await expect(page.getByRole('heading', { name: /One trusted record/i })).toBeVisible({ timeout: 15_000 });

  await page2.close();
});

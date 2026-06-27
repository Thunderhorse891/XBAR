import { expect, test } from '@playwright/test';

test('creates a fresh workspace and lands on the operations dashboard', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: 'One trusted record for every horse you sell.', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Add your first horse' }).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add your first horse' }).first().click();
  await expect(page).toHaveURL(/\/horses\?new=1$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Add a horse', exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Registered name').fill('Smart Lena Bar');
  await page.getByLabel('Barn name').fill('Lena');
  await page.getByLabel('Legal owner').fill('Blue River Ranch');
  await page.getByLabel('Owner entity').fill('Blue River Ranch LLC');
  const createHorseRecord = page.getByRole('button', { name: 'Create horse record' }).first();
  await expect(createHorseRecord).toBeEnabled({ timeout: 10_000 });
  await createHorseRecord.click();

  await expect(page).toHaveURL(/\/horses\/horse-/, { timeout: 15_000 });
  await expect(page.getByText('Horse record created')).toBeVisible({ timeout: 15_000 });

  const secondPage = await page.context().newPage();
  await secondPage.goto('/');
  await expect(secondPage.getByRole('heading', { name: 'Sale readiness, before the horse leaves the barn.', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(secondPage.getByText('SMART LENA BAR').first()).toBeVisible({ timeout: 15_000 });

  await secondPage.goto('/horses');
  await expect(secondPage.getByRole('heading', { name: 'Build your ranch workspace', exact: true })).toBeHidden({ timeout: 10_000 });
  await expect(secondPage.getByText('SMART LENA BAR').first()).toBeVisible({ timeout: 15_000 });
  await secondPage.close();
});

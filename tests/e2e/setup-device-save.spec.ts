import { expect, test, type Page } from '@playwright/test';

async function fillSetup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Synthetic Save Ranch LLC');
  await page.getByPlaceholder('Primary Ranch').fill('Synthetic Save Ranch');
}

for (const quick of [false, true]) {
  test(`${quick ? 'preview defaults' : 'workspace setup'} waits for its exact device save before leaving`, async ({
    page,
  }) => {
    await fillSetup(page);
    await page.evaluate(async () => {
      const storagePath = '/src/lib/workspaceStorage.ts';
      const { workspaceStateStorage, getWorkspacePersistReceipt } = await import(/* @vite-ignore */ storagePath);
      const original = workspaceStateStorage.setItem;
      workspaceStateStorage.setItem = (...args: Parameters<typeof original>) => {
        const pending = original(...args);
        const receipt = getWorkspacePersistReceipt();
        if (receipt)
          receipt.completed = receipt.completed.then(async (saved: boolean) => {
            await new Promise<void>((resolve) => {
              (window as typeof window & { releaseSetupSave?: () => void }).releaseSetupSave = resolve;
            });
            return saved;
          });
        return pending;
      };
    });
    await page.getByRole('button', { name: quick ? 'Use preview defaults' : 'Create workspace', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => Boolean((window as typeof window & { releaseSetupSave?: () => void }).releaseSetupSave)),
      )
      .toBe(true);
    await expect(page).toHaveURL(/\/app\/setup$/);
    await expect(page.getByRole('button', { name: 'Creating workspace...', exact: true })).toBeDisabled();
    await expect(page.getByText('Ranch created', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Ranch ready', { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as typeof window & { releaseSetupSave?: () => void }).releaseSetupSave?.());
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/app/horses');
    await expect(page.getByRole('heading', { name: 'Build your first sale-ready horse record.' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Build your first sale-ready horse record.' })).toBeVisible();
  });
}

test('a refused setup save keeps the draft and confirms only a durable retry', async ({ page }) => {
  await fillSetup(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    const setItem = Storage.prototype.setItem;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.transaction.db.name === 'xbar-workspace') throw new Error('Synthetic quota refusal');
      return put.apply(this, args);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('xbar-workspace') || key === 'xbar-live-workspace') throw new Error('Synthetic quota refusal');
      return setItem.call(this, key, value);
    };
    (window as typeof window & { restoreSetupStorage?: () => void }).restoreSetupStorage = () => {
      IDBObjectStore.prototype.put = put;
      Storage.prototype.setItem = setItem;
    };
  });
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'could not be saved on this device' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/setup$/);
  await expect(page.getByPlaceholder('Primary Ranch')).toHaveValue('Synthetic Save Ranch');
  await expect(page.getByText('Ranch created', { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as typeof window & { restoreSetupStorage?: () => void }).restoreSetupStorage?.());
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible();
});

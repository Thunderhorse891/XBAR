import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Action Feedback');
  await page.getByPlaceholder('Primary Ranch').fill('Feedback Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Test Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('feedback@example.test');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/equipment');
  await page.getByRole('button', { name: 'Add Equipment', exact: true }).first().click();
  return page.getByRole('dialog', { name: 'Add Equipment' });
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`create confirmation is readable after navigation at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const drawer = await setup(page);
    await drawer.getByPlaceholder('e.g. Stock trailer (24ft)').fill('Feedback trailer');
    await drawer.getByRole('button', { name: 'Add Equipment', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(page).toHaveURL(/\/assets\?asset=/);
    const confirmation = page.locator('[data-sonner-toast]').filter({ hasText: 'Feedback trailer added' });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText('Saved on this device');
    const box = await confirmation.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    await expect(page.locator('tbody tr').filter({ hasText: 'Feedback trailer' })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath(`ranch-action-feedback-${viewport.width}.png`), fullPage: true });
    await page.reload();
    await expect(page.locator('tbody tr').filter({ hasText: 'Feedback trailer' })).toHaveCount(1);
  });
}

test('refusal remains in the drawer after dismissing the popup and keeps the draft', async ({ page }) => {
  const drawer = await setup(page);
  await drawer.getByPlaceholder('e.g. Stock trailer (24ft)').fill('Preserved trailer');
  await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    useXbarStore.setState({ addRanchAsset: () => ({ ok: false, message: 'Your role cannot manage equipment.' }) });
  });
  await drawer.getByRole('button', { name: 'Add Equipment', exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveText('Your role cannot manage equipment.');
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Your role cannot manage equipment.' });
  await toast.getByRole('button', { name: 'Close toast' }).click();
  await expect(drawer.getByRole('alert')).toBeVisible();
  await expect(drawer.getByPlaceholder('e.g. Stock trailer (24ft)')).toHaveValue('Preserved trailer');
  await expect(drawer.getByRole('button', { name: 'Add Equipment', exact: true })).toBeEnabled();
});

test('an exception reports failure, keeps the draft and enables retry', async ({ page }) => {
  const drawer = await setup(page);
  await drawer.getByPlaceholder('e.g. Stock trailer (24ft)').fill('Retry trailer');
  await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    useXbarStore.setState({
      addRanchAsset: () => {
        throw new Error('Synthetic failed action');
      },
    });
  });
  await drawer.getByRole('button', { name: 'Add Equipment', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('could not be confirmed');
  await expect(drawer.getByRole('button', { name: 'Add Equipment', exact: true })).toBeEnabled();
  await expect(drawer.getByPlaceholder('e.g. Stock trailer (24ft)')).toHaveValue('Retry trailer');
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
});

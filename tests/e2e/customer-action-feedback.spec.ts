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
    await page.screenshot({
      path: testInfo.outputPath(`ranch-action-feedback-${viewport.width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
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

async function delayDeviceAcknowledgment(page: Page) {
  await page.evaluate(async () => {
    const storePath = '/src/store/useXbarStore.ts';
    const storagePath = '/src/lib/workspaceStorage.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ storePath);
    const { getWorkspacePersistReceipt } = await import(/* @vite-ignore */ storagePath);
    const original = useXbarStore.getState().addRanchAsset;
    useXbarStore.setState({
      addRanchAsset: (input: unknown) => {
        const result = original(input);
        const receipt = getWorkspacePersistReceipt();
        if (!receipt) throw new Error('Missing synthetic device-write receipt');
        const completed = receipt.completed;
        receipt.completed = new Promise((resolve) => {
          (window as unknown as { releaseFeedbackSave: () => Promise<void> }).releaseFeedbackSave = async () =>
            resolve(await completed);
        });
        return result;
      },
    });
  });
}

async function releaseDeviceAcknowledgment(page: Page) {
  await page.evaluate(() => (window as unknown as { releaseFeedbackSave: () => Promise<void> }).releaseFeedbackSave());
}

test('Back navigation while saving stays on the newer route after acknowledgment', async ({ page }) => {
  const drawer = await setup(page);
  // Exercise SPA Back/Forward while MainLayout stays mounted. Going back
  // across setup's page.goto would unload this document and its test controls.
  await drawer.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: 'Horses', exact: true }).first().click();
  await expect(page).toHaveURL(/\/horses$/);
  // The address changes before a lazy route commits. Wait for its content so
  // the next link creates a new entry instead of replacing a pending route.
  await expect(page.getByRole('heading', { name: 'Horses', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Equipment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Equipment & Maintenance', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add Equipment', exact: true }).first().click();
  await drawer.getByPlaceholder('e.g. Stock trailer (24ft)').fill('History trailer');
  await delayDeviceAcknowledgment(page);
  await drawer.getByRole('button', { name: 'Add Equipment', exact: true }).click();
  await expect(drawer.getByRole('status')).toContainText('Saving');
  await page.goBack();
  await expect(page).toHaveURL(/\/horses$/);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByPlaceholder('e.g. Stock trailer (24ft)')).toHaveValue('History trailer');
  const destination = page.url();
  await releaseDeviceAcknowledgment(page);
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'History trailer added' })).toBeVisible();
  await expect(page).toHaveURL(destination);
});

test('switching account during save requires reopening before an old draft can be submitted again', async ({
  page,
}) => {
  const drawer = await setup(page);
  await drawer.getByPlaceholder('e.g. Stock trailer (24ft)').fill('Old account trailer');
  await delayDeviceAcknowledgment(page);
  await drawer.getByRole('button', { name: 'Add Equipment', exact: true }).click();
  await expect(drawer.getByRole('status')).toContainText('Saving');
  await page.evaluate(async () => {
    const storePath = '/src/store/useXbarStore.ts';
    const cloudPath = '/src/store/useCloudStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ storePath);
    const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
    useCloudStore.setState({
      session: { user: { id: 'synthetic-other-account' } },
      workspaceId: 'synthetic-other-ranch',
    });
    useXbarStore.setState({
      workspaceProfile: { ...useXbarStore.getState().workspaceProfile, businessName: 'Different test ranch' },
    });
  });
  await releaseDeviceAcknowledgment(page);
  await expect(drawer.getByRole('alert')).toContainText('reopen');
  await drawer.getByRole('button', { name: 'Add Equipment', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('reopen');
  const count = await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    return useXbarStore.getState().ranchAssets.filter((asset: { name: string }) => asset.name === 'Old account trailer')
      .length;
  });
  expect(count).toBe(1);
});

test('a visible confirmation does not block starting the next task underneath it', async ({ page }) => {
  const drawer = await setup(page);
  await drawer.getByPlaceholder('e.g. Stock trailer (24ft)').fill('Next task trailer');
  await drawer.getByRole('button', { name: 'Add Equipment', exact: true }).click();
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Next task trailer added' });
  await expect(toast).toBeVisible();
  await page.getByRole('button', { name: 'Create', exact: true }).click({ timeout: 2000 });
  await expect(page.getByRole('menuitem', { name: 'Add Horse', exact: true })).toBeVisible();
  await expect(toast).toBeVisible();
});

test('mobile validation stays readable without stacking duplicate error popups', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const drawer = await setup(page);
  const submit = drawer.getByRole('button', { name: 'Add Equipment', exact: true });
  await submit.click();
  await submit.click();
  const errors = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(errors).toHaveCount(1);
  await expect(drawer.getByRole('alert')).toHaveText('Enter the equipment name.');
  await page.screenshot({
    path: testInfo.outputPath('ranch-action-feedback-mobile-error.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await errors.getByRole('button', { name: 'Close toast' }).click();
  await expect(drawer.getByRole('alert')).toBeVisible();
  await expect(drawer.getByPlaceholder('e.g. Stock trailer (24ft)')).toBeVisible();
});

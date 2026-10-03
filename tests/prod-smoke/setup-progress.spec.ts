import { expect, test, type Page } from '@playwright/test';

async function createWorkspace(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('xbar-command-center-entry', 'true');
  });
  await page.goto('/app/setup');
  await page.getByLabel('Business name').fill('Checklist Test Ranch');
  await page.getByLabel('Ranch name').fill('Checklist Test Ranch');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible();
}

async function openChecklist(page: Page) {
  await page.evaluate(() => {
    window.history.pushState({}, '', '/app/getting-started');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Getting started', exact: true })).toBeVisible();
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name} distinguishes workspace basics from the workflow checklist`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createWorkspace(page);
    await openChecklist(page);

    const basics = page.getByRole('button', { name: 'Workspace basics 2 of 4 complete', exact: true });
    if (viewport.name === 'desktop') await expect(basics).toBeVisible();
    else await expect(page.locator('.xs-setupbar')).toBeHidden();

    const checklist = page.locator('.xs-card').filter({ hasText: 'Workflow checklist' });
    await expect(checklist).toContainText('1 of 7 steps are complete.');
    await expect(page.getByText(/\d+% set up/)).toHaveCount(0);
    await expect(page.locator('.xs-checkitem')).toHaveCount(7);
    const billing = page.locator('.xs-checkitem').filter({ hasText: 'Review billing' });
    await expect(billing.getByLabel('Not done', { exact: true })).toBeVisible();

    // Opening billing does not buy a plan or falsely complete the paid-plan step.
    await billing.getByRole('button', { name: 'Open billing', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review Billing', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Getting started', exact: true })).toBeVisible();
    await expect(checklist).toContainText('1 of 7 steps are complete.');
    await expect(billing.getByLabel('Not done', { exact: true })).toBeVisible();
    await page.reload();
    await expect(checklist).toContainText('1 of 7 steps are complete.');
    if (viewport.name === 'desktop') await expect(basics).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: info.outputPath(`workspace-setup-progress-${viewport.name}.png`), fullPage: true });
  });
}

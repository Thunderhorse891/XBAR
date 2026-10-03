import { expect, test, type Page } from '@playwright/test';

async function createTestHorse(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toBeVisible();
  await page.getByPlaceholder('XBAR LLC').fill('Archive Test');
  await page.getByPlaceholder('Primary Ranch').fill('Archive Test Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Test Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('archive@example.test');
  await page.getByPlaceholder('Legal owner').fill('Test Owner');
  await page.getByPlaceholder('Owner entity').fill('Test Ranch');
  await page.getByPlaceholder('Barn A').fill('Barn A');
  await page.getByPlaceholder('Pasture 1').fill('North');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('Archive Test Horse');
  await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
  await expect(page).toHaveURL(/\/horses\//);
  await page.getByRole('button', { name: 'Horses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Horses', exact: true })).toBeVisible();
}

async function archiveHorse(page: Page) {
  await page.getByRole('button', { name: 'Open actions for Archive Test Horse' }).click();
  await page.getByRole('menuitem', { name: 'Archive from roster', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Active (0)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.horse-card')).toHaveCount(0);
}

test('Archive → Undo returns the original horse to the roster and remains restored after reload', async ({ page }) => {
  await createTestHorse(page);
  await archiveHorse(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.horse-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Active (1)', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.horse-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Archived (0)', exact: true })).toBeVisible();
});

test('Archived view persists across reload and offers Restore after Undo has gone', async ({ page }) => {
  await createTestHorse(page);
  await archiveHorse(page);
  await page.getByRole('button', { name: 'Archived (1)', exact: true }).click();
  await expect(page.locator('.horse-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archived (1)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Open actions for Archive Test Horse' }).click();
  await page.getByRole('menuitem', { name: 'Restore horse', exact: true }).click();
  await expect(page.locator('.horse-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Active (1)', exact: true }).click();
  await expect(page.locator('.horse-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.horse-card')).toHaveCount(1);
});

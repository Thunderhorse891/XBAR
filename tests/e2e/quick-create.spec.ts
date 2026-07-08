import { expect, test } from '@playwright/test';
import { bootstrapWorkspace, seedHorse } from './helpers';

// The quick-create surfaces must persist real records — a success toast with
// no stored data is a defect. These specs drive the prefilled flows opened
// from route-level buttons and assert the record is visible afterwards.

test('Add Health from a horse profile stores a real medical event', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Health Horse');

  await page.getByRole('button', { name: 'Add Health', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Health Record' });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('Record type').selectOption('Dental');
  await drawer.getByPlaceholder('Withdrawal date, dosage, vet…').fill('Float scheduled with Dr. Hale');
  await drawer.getByRole('button', { name: 'Add Record' }).click();
  await expect(drawer).toBeHidden();

  await page.getByRole('button', { name: 'Health', exact: true }).click();
  await expect(page.getByText('Float scheduled with Dr. Hale')).toBeVisible();
});

test('Move Horse from the profile updates its location', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Roaming Horse');

  await page.getByRole('button', { name: 'Move', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Move Horse' });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('e.g. South Pasture').fill('South Trap');
  await drawer.getByRole('button', { name: 'Move Horse' }).click();
  await expect(drawer).toBeHidden();

  await expect(page).toHaveURL(/\/pastures/, { timeout: 15_000 });
  await expect(page.locator('.xs-grid-2 .xs-card').filter({ hasText: 'South Trap' })).toBeVisible();
});

test('snoozed care tasks stay snoozed across a reload', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Task Horse');

  await page.getByRole('link', { name: 'Care Tasks', exact: true }).click();
  const firstTask = page.locator('.xs-task').first();
  await expect(firstTask).toBeVisible();
  const taskTitle = await firstTask.locator('.xs-task__title').innerText();
  const before = await page.locator('.xs-task').count();

  await firstTask.getByRole('button', { name: 'Snooze until tomorrow' }).click();
  await expect(page.locator('.xs-task')).toHaveCount(before - 1);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Care Tasks' })).toBeVisible();
  await expect(page.locator('.xs-task__title').filter({ hasText: taskTitle })).toHaveCount(0);
});

import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Keyboard Test');
  await page.getByPlaceholder('Primary Ranch').fill('Keyboard Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Test Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('keyboard@example.test');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/pastures');
}

test('drawer keeps keyboard focus inside, hides the background, and restores its opener', async ({ page }) => {
  await setup(page);
  const opener = page.getByRole('button', { name: 'Move Horse', exact: true, includeHidden: true }).first();
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Move Horse' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Move Horse');
  await expect.poll(() => drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await opener.focus();
  await expect.poll(() => drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
  const first = drawer.getByRole('button', { name: 'Close', exact: true });
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expect(opener).toBeFocused();
  await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', 'true');
  await opener.press('Enter');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('quick-create drawer returns focus to the persistent Create button', async ({ page }) => {
  await setup(page);
  const create = page.getByRole('button', { name: 'Create', exact: true });
  await create.click();
  await page.getByRole('menuitem', { name: 'Add Equipment', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Equipment', exact: true });
  await expect.poll(() => drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expect(create).toBeFocused();
  await create.press('Enter');
  await page.getByRole('menuitem', { name: 'Add Equipment', exact: true }).click();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(create).toBeFocused();
});

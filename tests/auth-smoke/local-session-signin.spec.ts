import { expect, test } from '@playwright/test';
import { blockWebfonts } from './support.js';

blockWebfonts();

for (const entry of ['settings', 'account menu']) {
  test(`a saved local workspace can sign in through ${entry} and keep its return path`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('xbar-command-center-entry', 'true');
      localStorage.setItem(
        'xbar-live-workspace',
        JSON.stringify({
          state: {
            workspaceProfile: {
              ranchName: 'Saved local ranch',
              setupCompleteAt: '2026-09-01T00:00:00.000Z',
            },
          },
          version: 0,
        }),
      );
    });

    await page.goto('/app/settings?section=cloud');
    await expect(page.getByText("You are viewing this browser's saved workspace.", { exact: false })).toBeVisible();
    if (entry === 'account menu') {
      await page.getByRole('button', { name: 'Account menu', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Sign in', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Sign in to your account', exact: true }).click();
    }

    await expect(page.getByRole('heading', { name: 'Sign In', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/login$/);
    expect(await page.evaluate(() => history.state?.usr?.from)).toBe('/settings?section=cloud');
  });
}

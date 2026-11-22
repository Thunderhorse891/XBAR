import { expect, test } from '@playwright/test';
import { blockWebfonts, RECOVERY_EMAIL, sessionLink, stubGoTrueUser } from './support.js';

blockWebfonts();

for (const outcome of ['success', 'failure'] as const) {
  test(`workspace setup sign-out ${outcome} before creating a workspace`, async ({ page }) => {
    await stubGoTrueUser(page);
    let logoutCalls = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/auth/v1/logout*', async (route) => {
      logoutCalls += 1;
      await held;
      await route.fulfill(
        outcome === 'success'
          ? { status: 204 }
          : {
              status: 400,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Sign-out temporarily unavailable' }),
            },
      );
    });
    await page.goto(sessionLink('signin').replace('/app/reset-password', '/app/setup'));
    await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toBeVisible();
    await expect(page.getByText(`Signed in as ${RECOVERY_EMAIL}.`)).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect.poll(() => logoutCalls).toBe(1);
    await expect(page.getByRole('button', { name: 'Signing out...' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeDisabled();
    release();
    if (outcome === 'success') {
      await expect(page).toHaveURL(/\/app\/login/);
      await page.goto('/app/setup');
      await expect(page).toHaveURL(/\/app\/login/);
      await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toHaveCount(0);
    } else {
      await expect(page.getByRole('alert')).toContainText('Sign-out temporarily unavailable');
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeEnabled();
      await expect(page).toHaveURL(/\/app\/setup/);
    }
    expect(logoutCalls).toBe(1);
  });
}

test('account deletion is usable before setup and refuses a mismatched confirmation without a request', async ({
  page,
}) => {
  await stubGoTrueUser(page);
  const attempts: string[] = [];
  await page.route('**/api/account/delete', async (route) => {
    attempts.push(route.request().postDataJSON().confirmation);
    await route.fulfill({
      status: 409,
      json: { ok: false, message: 'Synthetic ownership handoff needed.' },
    });
  });
  await page.goto(sessionLink('signin').replace('/app/reset-password', '/app/setup'));
  await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toBeVisible();
  await page.getByText('Delete account', { exact: true }).click();
  const confirmation = page.getByRole('textbox', { name: 'Type your email to confirm' });
  const submit = page.getByRole('button', { name: 'Permanently delete my account' });
  await expect(submit).toBeDisabled();
  await confirmation.fill('other@example.invalid');
  await expect(submit).toBeDisabled();
  expect(attempts).toEqual([]);
  await confirmation.fill(RECOVERY_EMAIL);
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('Synthetic ownership handoff needed.');
  expect(attempts).toEqual([RECOVERY_EMAIL]);
  await expect(page).toHaveURL(/\/app\/setup/);
});

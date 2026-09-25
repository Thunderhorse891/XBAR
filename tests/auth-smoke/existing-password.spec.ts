import { expect, test } from '@playwright/test';
import { blockWebfonts, readStoredAccessToken, RECOVERY_EMAIL, refreshedSession } from './support.js';

blockWebfonts();

// Existing credentials are validated by GoTrue, not by today's signup policy.
// These tests use the real form/auth client with a simulated account service.
for (const password of ['Old123', 'Old1234']) {
  test(`an existing ${password.length}-character password reaches auth and opens the account`, async ({ page }) => {
    let submitted: unknown;
    await page.route('**/auth/v1/token*', async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: refreshedSession() });
    });
    await page.goto('/app/login');
    await page.getByLabel('Email or User ID').fill(RECOVERY_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/billing(?:\?|$)/);
    expect(submitted).toMatchObject({ email: RECOVERY_EMAIL, password });
    await expect.poll(() => readStoredAccessToken(page)).not.toBe('');
  });
}

test('a rejected short password displays the auth error and creates no session', async ({ page }) => {
  await page.route('**/auth/v1/token*', (route) =>
    route.fulfill({ status: 400, json: { code: 'invalid_credentials', msg: 'Invalid login credentials' } }),
  );
  await page.goto('/app/login');
  const submit = page.getByRole('button', { name: 'Sign In', exact: true });
  await page.getByLabel('Email or User ID').fill(RECOVERY_EMAIL);
  await expect(submit).toBeDisabled();
  await page.getByLabel('Password', { exact: true }).fill('Wrong1');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('Invalid login credentials');
  await expect(submit).toBeEnabled();
  expect(await readStoredAccessToken(page)).toBe('');
  await expect(page).toHaveURL(/\/app\/login$/);
});

test('switching modes preserves the eight-character minimum for new accounts', async ({ page }) => {
  let signupRequests = 0;
  await page.route('**/auth/v1/signup*', async (route) => {
    signupRequests += 1;
    await route.fulfill({ status: 422, json: { msg: 'Test signup rejected' } });
  });
  await page.goto('/app/login');
  await page.getByLabel('Email or User ID').fill(RECOVERY_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill('Old1234');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create Account', exact: true })).toBeDisabled();
  await page.getByLabel('Password', { exact: true }).press('Enter');
  expect(signupRequests).toBe(0);
  await page.getByLabel('Password', { exact: true }).fill('New12345');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Test signup rejected');
  expect(signupRequests).toBe(1);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill('Old1234');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeEnabled();
});

import { expect, test } from '@playwright/test';
import { blockWebfonts } from './support.js';

blockWebfonts();

test('mobile signup and sign-in keep the title and intent accurate without submitting', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app/login?mode=signup');
  await expect(page.getByRole('heading', { name: 'Create Account', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Create account | XBAR');
  await expect(page.getByText('Creating an account does not start a subscription.', { exact: false })).toBeVisible();
  const submit = page.getByRole('button', { name: 'Create Account', exact: true });
  await expect(submit).toBeDisabled();
  expect((await submit.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  expect((await signIn.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  for (const link of await page.getByRole('navigation', { name: 'Legal and support' }).getByRole('link').all()) {
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await signIn.click();
  await expect(page).toHaveTitle('Sign in | XBAR');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveTitle('Create account | XBAR');
  await page.reload();
  await expect(page).toHaveTitle('Create account | XBAR');
  expect(errors).toEqual([]);
});

test('a paid-plan deep link stays an interest and does not change sign-in intent', async ({ page }) => {
  await page.goto('/app/login?mode=signup&plan=Professional');
  await expect(
    page.getByText('Your interest in Professional does not start a subscription.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveTitle('Sign in | XBAR');
  await expect(page.getByText('Sign in to your workspace.', { exact: true })).toBeVisible();
  await expect(page.getByText('Create an account and set up your workspace.', { exact: false })).toHaveCount(0);
});

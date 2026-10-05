import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
});

test('a checkout redirect waits for verification, times out truthfully and offers another check', async ({ page }) => {
  await page.clock.install();
  await page.goto('/app/billing?plan=Professional&checkout=success#professional');
  await expect(page.getByRole('heading', { name: 'Review Billing', exact: true })).toBeVisible();
  await expect(page.getByText('Payment completed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Payment received', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Confirming your payment…', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/billing\?plan=Professional#professional$/);
  await page.clock.fastForward(76_000);
  await expect(page.getByText("We're still confirming your payment.", { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(page.getByText('Confirming your payment…', { exact: true })).toBeVisible();
  await page.clock.fastForward(76_000);
  await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  await page.locator('.checkout-return-banner').getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.locator('.checkout-return-banner')).toHaveCount(0);
});

test('a cancelled return does not claim to know whether money moved', async ({ page }) => {
  await page.goto('/app/billing?checkout=cancelled');
  await expect(page.locator('.checkout-return-banner')).toBeVisible();
  await expect(page.getByText(/no charge was made/i)).toHaveCount(0);
  await expect(page.getByText('Checkout cancelled.', { exact: true })).toBeVisible();
  await page.locator('.checkout-return-banner').getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.locator('.checkout-return-banner')).toHaveCount(0);
});

test('choosing a plan after dismissing a return cannot put the stale checkout outcome back in the URL', async ({
  page,
}) => {
  await page.goto('/app/billing?plan=Professional&checkout=cancelled');
  await expect(page.locator('.checkout-return-banner')).toBeVisible();
  await page.locator('.checkout-return-banner').getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'View Ranch Ops', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/billing\?plan=Ranch\+Ops$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Review Billing', exact: true })).toBeVisible();
  await expect(page.locator('.checkout-return-banner')).toHaveCount(0);
});

import { expect, test, type Page } from '@playwright/test';
import { blockWebfonts, RECOVERY_EMAIL, stubGoTrueUser, userRecord } from './support.js';

blockWebfonts();

async function rejectedSignIn(
  page: Page,
  code = 'email_not_confirmed',
  message = 'PRIVATE_PROVIDER_DIAGNOSTIC',
  legacy = false,
) {
  await stubGoTrueUser(page);
  await page.route('**/auth/v1/token?grant_type=password', (route) =>
    route.fulfill({
      status: 400,
      // Auth-js accepts modern code with this header, or legacy error_code.
      headers: legacy ? {} : { 'x-supabase-api-version': '2024-01-01' },
      json: legacy ? { code: 400, error_code: code, msg: message } : { code, msg: message },
    }),
  );
  await page.goto('/app/login');
  await page.getByLabel('Email or User ID').fill(RECOVERY_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password-not-a-real-credential');
  await page.getByRole('button', { name: /^sign in$/i }).click();
}

test('structured unconfirmed sign-in immediately offers recovery and discards the password', async ({ page }) => {
  const resends: string[] = [];
  await page.route('**/auth/v1/resend*', (route) => {
    resends.push(route.request().url());
    return route.fulfill({ json: {} });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await rejectedSignIn(page);
  const heading = page.getByRole('heading', { name: 'Confirm your email', exact: true });
  await expect(heading).toBeVisible({ timeout: 5000 });
  await expect(heading).toBeFocused();
  await expect(page.getByRole('button', { name: 'Request confirmation email', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Review email address', exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('PRIVATE_PROVIDER_DIAGNOSTIC');
  expect(resends).toEqual([]);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`unconfirmed-recovery-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'Review email address', exact: true }).click();
  await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  await expect(page.getByLabel('Email or User ID')).toHaveValue(RECOVERY_EMAIL);
  await expect(page.getByLabel('Email or User ID')).toBeFocused();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.getByLabel('Email or User ID').fill('reachable-synthetic@example.invalid');
  await expect(page.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
});

test('a message mentioning confirmation without the structured code cannot select the recovery state', async ({
  page,
}) => {
  await rejectedSignIn(page, 'invalid_credentials', 'Email not confirmed');
  await expect(page.getByRole('heading', { name: 'Confirm your email', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request confirmation email' })).toHaveCount(0);
});

test('resend is user initiated, neutral and cooled down, with no password or account mutation', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/auth/v1/resend*', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  await rejectedSignIn(page);
  await expect(page.getByRole('heading', { name: 'Confirm your email', exact: true })).toBeVisible();
  await page.clock.install();
  const resend = page.getByRole('button', { name: 'Request confirmation email', exact: true });
  await resend.click();
  await expect(page.locator('.clean-confirmation')).toContainText(
    'If confirmation is needed, a new link has been requested. Check your inbox and spam folder.',
  );
  await expect(resend).toBeDisabled();
  expect(requests).toHaveLength(1);
  expect(requests[0].type).toBe('signup');
  expect(requests[0].email).toBe(RECOVERY_EMAIL);
  expect(requests[0]).not.toHaveProperty('password');
  await page.clock.fastForward(61000);
  await expect(resend).toBeEnabled();
  await resend.click();
  await expect.poll(() => requests.length).toBe(2);
});

test('rate-limited resends keep the recovery actions and hide provider diagnostics', async ({ page }) => {
  await page.route('**/auth/v1/resend*', (route) =>
    route.fulfill({ status: 429, json: { code: 'over_email_send_rate_limit', msg: 'PRIVATE_PROVIDER_DIAGNOSTIC' } }),
  );
  await rejectedSignIn(page);
  await expect(page.getByRole('heading', { name: 'Confirm your email', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Request confirmation email', exact: true }).click();
  await expect(page.locator('.clean-confirmation')).toContainText(
    'Please wait before requesting another confirmation email.',
  );
  await expect(page.locator('body')).not.toContainText('PRIVATE_PROVIDER_DIAGNOSTIC');
  await expect(page.getByRole('button', { name: 'Request confirmation email', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Go to sign in', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});

test('resend does not disclose an unrecognized account through its visible result', async ({ page }) => {
  await page.route('**/auth/v1/resend*', (route) =>
    route.fulfill({
      status: 400,
      json: { code: 400, error_code: 'user_not_found', msg: 'PRIVATE_PROVIDER_DIAGNOSTIC' },
    }),
  );
  await rejectedSignIn(page);
  await expect(page.getByRole('heading', { name: 'Confirm your email', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Request confirmation email', exact: true }).click();
  await expect(page.locator('.clean-confirmation')).toContainText(
    'If confirmation is needed, a new link has been requested. Check your inbox and spam folder.',
  );
  await expect(page.locator('body')).not.toContainText('PRIVATE_PROVIDER_DIAGNOSTIC');
});

test('one signup shows its destination and address review preserves the plan without another request', async ({
  page,
}) => {
  await stubGoTrueUser(page);
  let signups = 0;
  let resends = 0;
  await page.route('**/auth/v1/signup*', (route) => {
    signups += 1;
    return route.fulfill({
      json: { ...userRecord(), identities: [{ id: 'synthetic-email-identity', provider: 'email' }] },
    });
  });
  await page.route('**/auth/v1/resend*', (route) => {
    resends += 1;
    return route.fulfill({ json: {} });
  });
  await page.goto('/app/login?mode=signup&plan=Professional');
  await page.getByLabel('Email or User ID').fill(RECOVERY_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password-not-a-real-credential');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible();
  await expect(page.locator('.clean-confirmation__address strong')).toHaveText(RECOVERY_EMAIL);
  expect(signups).toBe(1);
  expect(resends).toBe(0);
  await page.getByRole('button', { name: 'Review email address', exact: true }).click();
  await expect(page.getByLabel('Email or User ID')).toBeFocused();
  await expect(page.getByLabel('Email or User ID')).toHaveValue(RECOVERY_EMAIL);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  expect(new URL(page.url()).searchParams.get('plan')).toBe('Professional');
  expect(signups).toBe(1);
});

test('legacy structured GoTrue codes select the same confirmation recovery', async ({ page }) => {
  await rejectedSignIn(page, 'email_not_confirmed', 'PRIVATE_PROVIDER_DIAGNOSTIC', true);
  await expect(page.getByRole('heading', { name: 'Confirm your email', exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('PRIVATE_PROVIDER_DIAGNOSTIC');
});

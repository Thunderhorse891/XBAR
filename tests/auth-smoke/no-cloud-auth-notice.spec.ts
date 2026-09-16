import { expect, test } from '@playwright/test';

/*
 * The other direction of the prod-smoke assertion.
 *
 * prod-smoke runs the local build, which has no Supabase env, and asserts the
 * "Cloud sign-in is not configured here" notice is shown before a password is
 * typed. On its own that passes just as well for a notice that renders
 * unconditionally -- which would tell every real customer their account is
 * unreachable while it is working fine.
 *
 * This bundle IS Supabase-configured, so the notice must be absent here, and
 * the affordance that only works with cloud auth must be present.
 */
test('a Supabase-configured build does not claim cloud sign-in is missing', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Cloud sign-in is not configured here' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
});

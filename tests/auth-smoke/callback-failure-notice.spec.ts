import { expect, test } from '@playwright/test';
import { blockWebfonts, readStoredAccessToken, sessionLink, stubGoTrueUser } from './support.js';

blockWebfonts();

/*
 * A callback that failed somewhere other than the sign-in screen.
 *
 * Magic-link and OAuth sign-in are offered from Settings as well as Login, and
 * `currentAuthRedirectUrl()` (useCloudStore.ts) sends Supabase back to the page
 * the customer started from -- so a rejected link returns to `/app/billing` or
 * `/app/settings` carrying `#error=...`. main.tsx moves that reason into
 * `?authError=`, and only `Login` has ever read that parameter. With a session
 * in hand the customer stayed where they were with nothing said at all; without
 * one the auth guard redirected to `/login` with a `<Navigate>` that drops the
 * query, so the reason was lost there too.
 *
 * `/app/billing` is used because it sits behind the cloud-auth guard but not
 * behind workspace setup, so the case is about the callback and not about
 * onboarding.
 */
test('a failed callback away from the sign-in screen still explains itself', async ({ page }) => {
  await stubGoTrueUser(page);
  await page.goto(sessionLink('signin'));
  await expect.poll(() => readStoredAccessToken(page), { timeout: 15_000 }).not.toBe('');

  await page.goto(
    '/app/billing#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
  );

  await expect(page.getByText(/Email link is invalid or has expired/i).first()).toBeVisible({ timeout: 15_000 });
  // Said once. A reload must not re-announce a failure already dealt with.
  await expect.poll(() => page.evaluate(() => window.location.search)).not.toContain('authError');
});

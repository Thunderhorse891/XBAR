import { expect, test } from '@playwright/test';
import { blockWebfonts, readStoredAccessToken, sessionLink, stubGoTrueUser } from '../auth-smoke/support.js';

blockWebfonts();

/*
 * A deep link opened on a device this account has never used.
 *
 * `useWorkspaceHydrated()` reports that zustand has read LOCAL storage, which
 * on a cold device resolves at once with an empty profile. RequireWorkspaceSetup
 * read that as "this ranch was never set up" and sent the customer to the
 * onboarding wizard; when the cloud profile landed a moment later the setup
 * screen bounced them to the dashboard, so the link they followed was lost and
 * a finished ranch was described as unfinished on the way.
 *
 * The workspace profile is held here rather than raced, so the window is a
 * fixed second instead of whatever this machine happens to give. Everything
 * else answers immediately, which is what makes the hold the only variable.
 */
test('a cold deep link waits for the cloud instead of diverting through setup', async ({ page }) => {
  const workspaceId = '7f1d0c44-0000-4000-8000-0000000000ab';
  const navigations: string[] = [];
  let holdProfile = false;

  await stubGoTrueUser(page);
  await page.route('**/rest/v1/**', async (route) => {
    const table = new URL(route.request().url()).pathname.split('/').pop();
    if (table === 'workspaces') return route.fulfill({ status: 200, json: { id: workspaceId } });
    const single = table === 'workspace_profiles' || table === 'workspace_subscription_profiles';
    if (table === 'workspace_profiles' && holdProfile) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    await route.fulfill({
      status: 200,
      json: single
        ? {
            payload:
              table === 'workspace_profiles'
                ? { setupCompleteAt: '2026-09-10T12:00:00Z', ranchName: 'Cold device ranch', businessName: 'Fixture' }
                : {},
            updated_at: '2026-09-10T12:00:00Z',
          }
        : [],
    });
  });

  await page.goto(sessionLink('signin'));
  await expect(page.getByText(/This page needs a current password-reset link/)).toBeVisible();
  await expect.poll(() => readStoredAccessToken(page), { timeout: 15_000 }).not.toBe('');

  /*
   * A genuinely cold device, staged rather than raced.
   *
   * Clearing the records from inside the app's own document did not hold: the
   * first page is still hydrating while the test clears, so it wrote the
   * workspace profile back before the next navigation and the guard was never
   * asked anything. With the fix reverted that made the case pass 2 times in 6
   * -- it discriminated by luck.
   *
   * The marketing page at '/' is the same origin and does not boot the app, so
   * storage can be emptied there with nothing running to refill it, and only
   * the session put back.
   *
   * And the records live in IndexedDB ('xbar-workspace'), not localStorage --
   * see lib/workspaceStorage.ts, where localStorage is only the fallback. A
   * localStorage-only clear left the whole workspace in place, so the device was
   * never cold and the case passed 6 times in 6 with the fix reverted. Both
   * stores have to go.
   */
  const sessionKey = await page.evaluate(
    () => Object.keys(localStorage).find((key) => key.startsWith('sb-') && key.endsWith('-auth-token')) ?? '',
  );
  expect(sessionKey, 'the session has to survive; only the records are being taken away').not.toBe('');
  const sessionValue = await page.evaluate((key) => localStorage.getItem(key) ?? '', sessionKey);

  await page.goto('/');
  await page.evaluate(
    async ([key, value]) => {
      localStorage.clear();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('xbar-workspace');
        request.onsuccess = () => resolve();
        request.onblocked = () => resolve();
        request.onerror = () => reject(new Error('could not clear the workspace database'));
      });
      localStorage.setItem(key, value);
    },
    [sessionKey, sessionValue],
  );

  holdProfile = true;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname);
  });

  await page.goto('/app/settings');
  /*
   * Which loading shell is on screen during the hold is deliberately not
   * asserted. RequireCloudAuth has one of its own and can cover the whole
   * window, so pinning the inner one measured this machine rather than the
   * behaviour -- it was absent in 5 of 10 runs while every assertion below
   * still held. What the customer must not see is a screen claiming their
   * ranch needs setting up, and that is what the navigation trail records.
   */
  await expect(page.getByRole('button', { name: 'Pull cloud', exact: true })).toBeVisible({ timeout: 20_000 });

  expect(navigations, 'a finished ranch must never be routed through onboarding to reach a deep link').not.toContain(
    '/app/setup',
  );
  expect(new URL(page.url()).pathname).toBe('/app/settings');
});

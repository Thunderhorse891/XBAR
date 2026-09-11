import { expect, test } from '@playwright/test';
import { blockWebfonts, readStoredAccessToken, sessionLink, stubGoTrueUser } from './support.js';

blockWebfonts();

/*
 * The service worker must not reload a page that is consuming a link.
 *
 * The worker installs with skipWaiting() and activates with clients.claim(),
 * so on a FIRST visit -- no controller yet -- it claims this very document and
 * fires 'controllerchange'. src/lib/offlineRuntime.ts used to reload on that
 * unconditionally, which put a full document navigation roughly 200ms into
 * every first load.
 *
 * That is squarely on top of the one network call that turns a recovery or
 * magic link into a session: auth-js awaits `GET /auth/v1/user` inside
 * `_getSessionFromURL`, and only after it resolves does it clear the fragment
 * and hand the session over to be saved. Measured before the fix, the reload
 * aborted that request in 10 of 12 runs. It survived only because the fragment
 * is cleared AFTER the request, so the reloaded document could start over --
 * paying the round trip twice and publishing the session ~180ms late. A reload
 * arriving a few milliseconds later, between the fragment being cleared and the
 * session being stored, has neither copy to start over from and burns a
 * one-time link.
 *
 * So the assertion is about the document, not about a timing margin: arriving
 * on a session link must produce ONE document and ONE /auth/v1/user call.
 *
 * Both guards in offlineRuntime.ts independently prevent this reload -- a first
 * visit has no earlier controller AND holds a credential in the URL -- so this
 * case only fails when BOTH are removed, and it was checked that way. The two
 * are told apart one at a time in tests/offlineRuntime.test.ts, which can stage
 * a worker update that a browser test here cannot.
 */
test('a first visit on a session link is not reloaded by the service worker', async ({ page }) => {
  const userCalls: string[] = [];
  const abortedUserCalls: string[] = [];
  const documents: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/auth/v1/user')) userCalls.push(request.method());
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('/auth/v1/user')) {
      abortedUserCalls.push(`${request.method()} ${request.failure()?.errorText ?? 'unknown'}`);
    }
  });
  /*
   * Runs once per DOCUMENT, and counts in sessionStorage rather than on
   * `window`.
   *
   * A reload replaces the JS context, so a counter held on `window` is reset by
   * the very thing it is meant to detect and reads 1 whether the page reloaded
   * or not. sessionStorage survives a reload in the same tab, which is exactly
   * the lifetime being measured.
   */
  await page.addInitScript(() => {
    const key = 'xbar-document-loads';
    sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? '0') + 1));
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) documents.push(frame.url());
  });

  await stubGoTrueUser(page);
  await page.goto(sessionLink('signin'));
  await expect(page.getByText(/This page needs a current password-reset link/)).toBeVisible();
  await expect.poll(() => readStoredAccessToken(page), { timeout: 15_000 }).not.toBe('');

  // The worker has to have taken over, or this case proves nothing: with no
  // claim there is no 'controllerchange' and therefore no reload to suppress.
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), { timeout: 15_000 })
    .toBe(true);

  expect(abortedUserCalls, 'the session call must not be cut off by a navigation').toEqual([]);
  expect(userCalls, 'one visit, one exchange of the link for a session').toEqual(['GET']);
  expect(
    await page.evaluate(() => Number(sessionStorage.getItem('xbar-document-loads') ?? '0')),
    'the service worker claiming this page must not reload it',
  ).toBe(1);
});

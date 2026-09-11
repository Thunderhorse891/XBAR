import { expect, test } from '@playwright/test';
import {
  blockWebfonts,
  readStoredAccessToken,
  SECOND,
  sessionLink,
  stubGoTrueUser,
  USER_ID,
} from '../auth-smoke/support.js';

blockWebfonts();

/*
 * A cross-tab sign-in whose storage write has not reached this renderer yet.
 *
 * localStorage is not synchronously coherent across renderer processes, so
 * another tab's SIGNED_IN BroadcastChannel message can arrive before the write
 * it describes is visible here. Reproduced naturally 2 times in 120 runs, with
 * the same trace both times:
 *
 *   STORE     sub=0001
 *   BROADCAST event=SIGNED_IN eventSub=0002 storedSub=0001
 *
 * The listener read 0001, judged the perfectly good 0002 event stale, dropped
 * it, and the tab stayed on the previous account until it was reloaded.
 *
 * A 1.7% race is not a test. The delay is staged instead: this tab's reads of
 * the auth record are pinned to their first value for a short window, which is
 * exactly what the slow renderer saw, and deterministic.
 */
test('a sign-in broadcast that outruns its storage write is still applied', async ({ page, context }) => {
  const workspaceId = '7f1d0c44-0000-4000-8000-0000000000aa';
  const secondWorkspaceId = '7f1d0c44-0000-4000-8000-0000000000bb';
  const relationalReads: string[] = [];

  await page.addInitScript(() => {
    /*
     * Reproduce the propagation delay off the VALUE, not off a clock.
     *
     * A first attempt froze reads for a fixed window starting at the first
     * read; by the time the other tab signed in the window had long expired, so
     * the case passed with the fix reverted and proved nothing. What actually
     * characterises the defect is that the first reads AFTER another renderer's
     * write still return the previous value. So: whenever this tab notices the
     * auth record has changed, serve the previous value for the next few reads.
     * Only the auth key is touched, and only reads -- the record itself is
     * never altered.
     */
    const STALE_READS = 3;
    const getItem = Storage.prototype.getItem;
    let lastSeen: string | null | undefined;
    let hiddenValue: string | null | undefined;
    let staleReadsLeft = 0;
    Storage.prototype.getItem = function (key) {
      const live = getItem.call(this, key);
      const isAuthRecord = String(key).startsWith('sb-') && String(key).endsWith('-auth-token');
      if (!isAuthRecord) return live;
      if (lastSeen === undefined) {
        lastSeen = live;
        return live;
      }
      /*
       * Armed ONCE per new value. A first version re-armed on every read while
       * the values differed, so the simulated storage never caught up at all --
       * permanent staleness rather than a propagation delay, which made the
       * case fail even WITH the fix. Caught by dumping the reads: the tab had
       * made none.
       */
      if (live !== lastSeen && hiddenValue !== live) {
        hiddenValue = live;
        staleReadsLeft = STALE_READS;
      }
      if (staleReadsLeft > 0) {
        staleReadsLeft -= 1;
        return lastSeen ?? null;
      }
      lastSeen = live;
      return live;
    };
  });

  await stubGoTrueUser(page);
  await page.route(/\/rest\/v1\/(workspaces|workspace_memberships|workspace_invitations)/, async (route) => {
    const url = route.request().url();
    const body = url.includes('/workspaces?')
      ? JSON.stringify({ id: url.includes(SECOND.id) ? secondWorkspaceId : workspaceId })
      : '[]';
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await page.route(/\/rest\/v1\/horses/, async (route) => {
    relationalReads.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // This tab signs in as the first account and settles.
  await page.goto(sessionLink('signin'));
  await expect.poll(() => readStoredAccessToken(page), { timeout: 30_000 }).not.toBe('');
  await expect.poll(() => relationalReads.some((url) => url.includes(workspaceId)), { timeout: 30_000 }).toBe(true);
  relationalReads.length = 0;

  // A second tab signs in as a DIFFERENT account. Its broadcast reaches the
  // first tab while that tab's storage view is still pinned to account one.
  const second = await context.newPage();
  await stubGoTrueUser(second, undefined, SECOND);
  await second.route(/\/rest\/v1\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: route.request().url().includes('/workspaces?') ? JSON.stringify({ id: secondWorkspaceId }) : '[]',
    }),
  );
  await second.goto(sessionLink('signin', SECOND));
  await expect.poll(() => readStoredAccessToken(second), { timeout: 30_000 }).not.toBe('');

  const logs: string[] = [];
  page.on('console', (m) => logs.push(`${m.type()} ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => logs.push(`pageerror ${e.message}`));

  // The first tab must take the switch over, not sit on the old account.
  try {
    await expect
      .poll(() => relationalReads.some((url) => url.includes(secondWorkspaceId)), { timeout: 20_000 })
      .toBe(true);
  } catch (error) {
    console.log(
      '\n@@@@ reads after the switch: ' +
        JSON.stringify(
          relationalReads.map((url) => url.slice(url.indexOf('/rest/v1/'), url.indexOf('/rest/v1/') + 70)),
        ) +
        '\n@@@@ console: ' +
        logs.slice(-12).join('\n@@@@   '),
    );
    throw error;
  }
  expect(
    relationalReads.some((url) => url.includes(USER_ID)),
    'the superseded account must not be hydrated again',
  ).toBe(false);
});

/*
 * The same propagation delay, in the other direction: a sign-out.
 *
 * A REMOVAL is equally slow to become visible across renderers, so a tab
 * sharing the session that was just ended reads it as still present. The first
 * version of this fix excluded sign-outs on the grounds that dropping one that
 * is not ours is the safe direction; that confused "safe" with "correct".
 * Dropping a real sign-out leaves the tab showing an authenticated workspace
 * for an account that has signed out, until it is reloaded.
 */
test('a sign-out broadcast that outruns its storage removal is still applied', async ({ page, context }) => {
  const workspaceId = '7f1d0c44-0000-4000-8000-0000000000aa';

  await page.addInitScript(() => {
    const STALE_READS = 3;
    const getItem = Storage.prototype.getItem;
    let lastSeen: string | null | undefined;
    let hiddenValue: string | null | undefined;
    let staleReadsLeft = 0;
    Storage.prototype.getItem = function (key) {
      const live = getItem.call(this, key);
      const isAuthRecord = String(key).startsWith('sb-') && String(key).endsWith('-auth-token');
      if (!isAuthRecord) return live;
      if (lastSeen === undefined) {
        lastSeen = live;
        return live;
      }
      if (live !== lastSeen && hiddenValue !== live) {
        hiddenValue = live;
        staleReadsLeft = STALE_READS;
      }
      if (staleReadsLeft > 0) {
        staleReadsLeft -= 1;
        return lastSeen ?? null;
      }
      lastSeen = live;
      return live;
    };
  });

  const workspaceRest = (route: import('@playwright/test').Route) => {
    const url = route.request().url();
    const single = /workspace_(profiles|subscription_profiles)/.test(url);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: url.includes('/workspaces?')
        ? JSON.stringify({ id: workspaceId })
        : single
          ? JSON.stringify({
              payload: url.includes('workspace_profiles')
                ? { setupCompleteAt: '2026-09-10T12:00:00Z', ranchName: 'Sign-out fixture', businessName: 'Fixture' }
                : {},
              updated_at: '2026-09-10T12:00:00Z',
            })
          : '[]',
    });
  };

  await stubGoTrueUser(page);
  await page.route(/\/rest\/v1\//, workspaceRest);
  await page.route('**/auth/v1/logout*', (route) => route.fulfill({ status: 204, body: '' }));

  await page.goto(sessionLink('signin'));
  await expect.poll(() => readStoredAccessToken(page), { timeout: 30_000 }).not.toBe('');

  /*
   * Park this tab on a screen that only a signed-in session can show. That is
   * what makes the assertion discriminating: a first version left it on the
   * reset screen, where the wording matched whether the sign-out had been
   * processed or not, and the case passed with the fix reverted.
   */
  await page.goto('/app/settings');
  await expect(page.getByRole('button', { name: 'Pull cloud', exact: true })).toBeVisible({ timeout: 30_000 });

  // A second tab in the same browser shares that session, and signs out.
  const second = await context.newPage();
  await stubGoTrueUser(second);
  await second.route(/\/rest\/v1\//, workspaceRest);
  await second.route('**/auth/v1/logout*', (route) => route.fulfill({ status: 204, body: '' }));
  await second.goto('/app/settings');
  await second.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect.poll(() => readStoredAccessToken(second), { timeout: 30_000 }).toBe('');

  // The first tab must follow the account out rather than keep showing its
  // workspace to someone who has signed out.
  await expect(page.getByRole('button', { name: 'Pull cloud', exact: true })).toBeHidden({ timeout: 30_000 });
});

import { expect, test, type Page } from '@playwright/test';
import {
  blockWebfonts,
  recoveryLink,
  RECOVERY_KEY,
  sessionLink,
  stubGoTrueUser,
  USER_ID,
  userRecord,
} from './support.js';

/*
 * The reset screen, rendered.
 *
 * tests/passwordRecovery.test.ts pins the two decisions this flow turns on --
 * whether a grant belongs to the session holding it, and which single state the
 * screen is in -- but a pure function cannot show that the screen draws them.
 * Both bugs that shipped here were invisible to unit tests: a genuine recovery
 * link opened a screen that refused it, and a completed reset rendered the
 * success message and the expired-link refusal at the same time.
 *
 * So this suite drives the real machinery end to end. Nothing seeds the store:
 * the grant is established the only way the app accepts one, by auth-js parsing
 * an implicit-flow recovery fragment and emitting PASSWORD_RECOVERY, and it is
 * released the only way the app releases one, by a real updateUser round trip.
 * The two GoTrue endpoints that round trip touches are fulfilled locally; the
 * client code under test is untouched.
 *
 * Supabase is CONFIGURED in this bundle (scripts/build-auth-smoke.mjs). Under
 * the local-mode bundle the prod-smoke suite uses, every assertion below would
 * pass against a screen that only ever says "Cloud accounts are not configured
 * in this build" -- proving nothing.
 *
 * Each test was checked against the defect it exists for, by reintroducing that
 * defect and rebuilding: the named test failed and the others stayed green.
 *
 *   removing the `done` precedence from resetScreenState
 *       -> "a completed reset reports success and does not also claim ..."
 *   hasValidatedPasswordRecovery returning Boolean(session)
 *       -> "being signed in is not a recovery link"
 *   discarding the PASSWORD_RECOVERY event again
 *       -> "a genuine recovery link opens the form"
 *   clearing the grant before updateUser's outcome is known
 *       -> "a rejected update stays retryable and keeps the grant"
 *   releasing the grant on SIGNED_OUT only, not USER_UPDATED
 *       -> "spending the grant in one tab ends it in the other"
 *   letting a rejected updateUser go unhandled in the store
 *       -> "a submission cut short by another tab is told so ..."
 *   removing the `saving` precedence from resetScreenState
 *       -> "a completed reset reports success and does not also claim ..."
 *          (NOT the cut-short case -- see the note on it)
 */

blockWebfonts();

const refusal = (page: Page) => page.getByText(/This page needs a current password-reset link/);
const newPassword = (page: Page) => page.getByLabel('New password', { exact: true });
const confirmPassword = (page: Page) => page.getByLabel('Confirm new password');
const submit = (page: Page) => page.getByRole('button', { name: 'Set new password' });

type ScreenSnapshot = { success: boolean; refused: boolean; form: boolean; saving: boolean; unconfirmed: boolean };

/*
 * Records every distinct state the screen passes through, rather than what it
 * happens to be showing when an assertion runs.
 *
 * Polling for a good state is not good enough here, and that is not
 * hypothetical: with the `done` precedence removed from resetScreenState the
 * screen really does render "Password updated" and "request another link"
 * together -- and then leaves that state again a moment later, so a poll for
 * "success and no refusal" finds the later clean sample and passes. The
 * contradiction has to be forbidden at every instant, not merely absent at
 * some instant.
 *
 * A MutationObserver is the whole mechanism. This also ran a 10ms interval,
 * on the stated grounds that it caught renders the observer missed -- which it
 * cannot: two renders in one task leave the DOM at its final state, and a
 * sampler reads the same settled DOM the observer does. So it bought nothing
 * and cost a forced layout a hundred times a second, for the life of the page,
 * including after the success screen hands off to the workspace. That is a
 * plausible source of the 60s timeout seen on a slower machine, and it was
 * removed rather than left in as insurance against a case it never covered.
 */
async function watchScreen(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    const snap = () => {
      // Lower-cased because innerText is the RENDERED text: the field labels
      // and the submit button are upper-cased in CSS, so matching them as
      // written in the JSX quietly never matched and left `form` and `saving`
      // permanently false -- flags that look like coverage and assert nothing.
      const text = document.body.innerText.toLowerCase();
      const state = JSON.stringify({
        success: text.includes('password updated. you are signed in.'),
        refused: text.includes('needs a current password-reset link'),
        form: text.includes('confirm new password'),
        saving: text.includes('saving...'),
        unconfirmed: text.includes('could not confirm that change'),
      });
      if (seen[seen.length - 1] !== state) seen.push(state);
    };
    (window as unknown as { __screenStates: string[] }).__screenStates = seen;
    snap();
    new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

async function observedScreens(page: Page): Promise<ScreenSnapshot[]> {
  const raw = await page.evaluate(() => (window as unknown as { __screenStates?: string[] }).__screenStates);
  if (!raw) {
    // The recorder lives on `window`, so a navigation takes it with it. The
    // success screen hands off to the workspace after a couple of seconds, and
    // reading the states after that would otherwise fail as an opaque
    // TypeError on undefined rather than naming what happened.
    throw new Error('Screen recorder is gone: the page navigated before the recorded states were read.');
  }
  return raw.map((entry) => JSON.parse(entry) as ScreenSnapshot);
}

/*
 * Fails the test on an uncaught page error instead of letting it surface as a
 * puzzling timeout somewhere later. A remounted or crashed screen is exactly
 * the kind of thing that otherwise reads as "the button never said Saving".
 */
function recordPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  return errors;
}

async function heldGrant(page: Page) {
  return page.evaluate((key) => window.sessionStorage.getItem(key) ?? '', RECOVERY_KEY);
}

async function fillNewPassword(page: Page, value: string) {
  await newPassword(page).fill(value);
  await confirmPassword(page).fill(value);
}

test('without a recovery link the screen refuses instead of offering a password form', async ({ page }) => {
  await stubGoTrueUser(page);

  // No fragment: nobody has established that a recovery link was followed.
  await page.goto('/app/reset-password');

  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to sign in' })).toBeVisible();

  // Nothing was granted, which is what the refusal is reporting.
  expect(await heldGrant(page)).toBe('');
});

test('being signed in is not a recovery link', async ({ page }) => {
  await stubGoTrueUser(page);

  /*
   * The hole this screen was built to close, and the reason the grant is a user
   * id rather than "there is a session". Gating on the session alone meant
   * anyone already signed in who reached this URL -- following a spent recovery
   * link, or simply navigating here -- got a working form that changed the
   * password of whatever account happened to be signed in.
   *
   * This link carries a real, valid session. It is not a recovery.
   */
  await page.goto(sessionLink('signin'));

  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(page)).toHaveCount(0);

  // The session exists -- so the refusal is about the missing recovery, not
  // about being signed out.
  expect(await page.evaluate(() => Object.keys(window.localStorage).some((key) => key.includes('auth-token')))).toBe(
    true,
  );
  expect(await heldGrant(page)).toBe('');
});

test('a genuine recovery link opens the form', async ({ page }) => {
  await stubGoTrueUser(page);

  await page.goto(recoveryLink());

  // This is what makes the refusal test above mean something: the screen is
  // capable of opening, so refusing is a decision rather than the only thing it
  // ever does.
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  await expect(submit(page)).toBeEnabled();
  await expect(refusal(page)).toHaveCount(0);

  // The grant is recorded against the user Supabase validated the link for --
  // not merely "someone is signed in".
  expect(await heldGrant(page)).toBe(USER_ID);
});

test('a completed reset reports success and does not also claim the link expired', async ({ page }) => {
  await stubGoTrueUser(page);
  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  await fillNewPassword(page, 'a-brand-new-password');
  await watchScreen(page);
  await submit(page).click();

  await expect(page.getByText('Password updated. You are signed in.').first()).toBeVisible();

  /*
   * The regression this suite exists for. Finishing a reset CLEARS the grant --
   * that is the point of it -- and the screen used to read that absence as a
   * dead link, so it announced the reset had worked and told the customer to
   * request another link, in the same breath.
   *
   * From a form the customer just submitted there is no route to the
   * expired-link refusal, so it may not appear at any point along the way.
   */
  const screens = await observedScreens(page);
  expect(screens.filter((state) => state.refused)).toEqual([]);
  expect(screens.some((state) => state.success)).toBe(true);

  // And the grant really is gone, so the assertion above is not passing because
  // the refusal condition was never true.
  expect(await heldGrant(page)).toBe('');
});

test('restoring a recovery tab without a session discards its old grant', async ({ page }) => {
  await stubGoTrueUser(page);
  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  expect(await heldGrant(page)).toBe(USER_ID);

  // Model a missed sign-out while unloaded: shared auth storage is gone,
  // but the tab-local grant survives and no spent-user record was written.
  const removed = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
    keys.forEach((key) => localStorage.removeItem(key));
    return keys.length;
  });
  expect(removed).toBe(1);
  await page.reload();
  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });
  expect(await heldGrant(page)).toBe('');

  // An ordinary sign-in to the same account must not revive the old grant.
  await page.goto(sessionLink('signin'));
  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(page)).toHaveCount(0);
  expect(await heldGrant(page)).toBe('');
});

test('a sign-out event without a local grant revokes an unloaded recovery tab', async ({ context }) => {
  const recovery = await context.newPage();
  await stubGoTrueUser(recovery);
  await recovery.goto(recoveryLink());
  await expect(newPassword(recovery)).toBeVisible({ timeout: 30_000 });
  await recovery.goto('about:blank');

  const other = await context.newPage();
  await stubGoTrueUser(other);
  await other.goto('/app/reset-password');
  await expect(refusal(other)).toBeVisible({ timeout: 30_000 });
  expect(await heldGrant(other)).toBe('');
  // Deliver the auth-js sign-out protocol while the recovery tab is unloaded.
  // This covers the subscriber and durable revocation, not the sign-out UI.
  await other.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
    if (!key) throw new Error('Expected the shared authenticated session');
    localStorage.removeItem(key);
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: 'SIGNED_OUT', session: null });
    channel.close();
  });
  await expect
    .poll(() => other.evaluate((id) => localStorage.getItem(`xbar-password-recovery-spent:user:${id}`), USER_ID))
    .toBe('spent');

  await other.goto(sessionLink('signin'));
  await expect(refusal(other)).toBeVisible({ timeout: 30_000 });
  await recovery.goto('/app/reset-password');
  await expect(refusal(recovery)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(recovery)).toHaveCount(0);
});

test('submitting actually sends a password request', async ({ page }) => {
  /*
   * The one check no screen assertion can stand in for: that a request left
   * the browser at all.
   *
   * This is not hypothetical. An earlier attempt to make the check and the
   * mutation atomic wrapped both in auth-js's own lock, and `_acquireLock`
   * pushes the outer callback into `pendingInLock` before running it -- so a
   * nested getSession awaited the very promise waiting on it. Every submission
   * deadlocked and NO request was ever sent, while the entire source-level
   * suite stayed green, because nothing in it asserted the wire.
   *
   * Deliberately blind to HOW the request is made, so it keeps its value
   * whichever way the mutation is implemented.
   */
  const sent: string[] = [];
  await page.route('**/auth/v1/user*', async (route) => {
    if (route.request().method() === 'PUT') sent.push(route.request().headers()['authorization'] ?? '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
  });

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  await fillNewPassword(page, 'a-brand-new-password');
  await submit(page).click();
  await expect(page.getByText('Password updated. You are signed in.').first()).toBeVisible();

  expect(sent).toHaveLength(1);
  // Carrying a bearer token: the credential the change is applied under,
  // observed on the wire rather than inferred from the source.
  expect(sent[0]).toMatch(/^Bearer .+/);
});

test('the change targets the validated account even with no Web Locks', async ({ context }) => {
  /*
   * The invariant on the browser where the previous remedy protected nothing.
   *
   * Holding auth-js's session lock around the check and the mutation only works
   * where `navigator.locks` exists: without it auth-js selects `lockNoOp`,
   * which runs the callback with no exclusion at all. This build targets
   * safari13 (vite.config.ts), so that fallback ships -- the lock was absent on
   * a browser we support, and the correct-account invariant went with it.
   *
   * Web Locks are removed here for exactly that reason. The change still has to
   * reach the account the link was issued for, because the request carries that
   * session's token rather than re-reading an ambient one.
   */
  const page = await context.newPage();
  await page.addInitScript(() => {
    // The Safari 13 shape: no navigator.locks at all.
    Object.defineProperty(navigator, 'locks', { get: () => undefined, configurable: true });
  });

  const sent: string[] = [];
  await page.route('**/auth/v1/user*', async (route) => {
    if (route.request().method() === 'PUT') sent.push(route.request().headers()['authorization'] ?? '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
  });

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  const grantToken = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((entry) => entry.includes('auth-token'));
    return key ? (JSON.parse(window.localStorage.getItem(key) ?? '{}').access_token ?? '') : '';
  });
  expect(grantToken).not.toBe('');

  await fillNewPassword(page, 'a-brand-new-password');
  await submit(page).click();
  await expect(page.getByText('Password updated. You are signed in.').first()).toBeVisible();

  // The request carried the validated session's own token -- so which account
  // is changed does not depend on a lock that this browser does not have.
  expect(sent).toEqual([`Bearer ${grantToken}`]);
});

test('a rejected update stays retryable and keeps the grant', async ({ page }) => {
  await stubGoTrueUser(page, async (route) => {
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 422,
        error_code: 'same_password',
        msg: 'New password should be different from the old password.',
      }),
    });
  });

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  await fillNewPassword(page, 'a-brand-new-password');
  await submit(page).click();

  // GoTrue's own words, not a rewrite of them: describeAuthError only replaces
  // transport failures, so a real rejection reaches the customer intact.
  await expect(page.getByText('New password should be different from the old password.').first()).toBeVisible();

  // A failed update is not a finished recovery. The form has to still be here,
  // still usable, and must not have announced success.
  await expect(page.getByText('Password updated. You are signed in.')).toHaveCount(0);
  await expect(refusal(page)).toHaveCount(0);
  await expect(submit(page)).toBeEnabled();
  await fillNewPassword(page, 'another-attempt-entirely');
  await expect(submit(page)).toBeEnabled();

  // The grant survives, or the customer would be told to request a new link
  // because the server declined the password they chose.
  expect(await heldGrant(page)).toBe(USER_ID);
});

test('spending the grant in one tab ends it in the other', async ({ context }) => {
  /*
   * The store and its sessionStorage marker are tab-local, but a recovery is
   * not: auth-js broadcasts it to every open tab. Clearing the grant only where
   * updatePassword ran left the other tab holding a spent one -- able to set
   * the password again with no new link. auth-js broadcasts USER_UPDATED after
   * the change, which is how the second tab learns its grant is over.
   */
  const first = await context.newPage();
  const second = await context.newPage();
  await stubGoTrueUser(first);
  await stubGoTrueUser(second);

  await first.goto(recoveryLink());
  await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
  await second.goto(recoveryLink());
  await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });
  expect(await heldGrant(second)).toBe(USER_ID);

  await fillNewPassword(first, 'a-brand-new-password');
  await submit(first).click();
  await expect(first.getByText('Password updated. You are signed in.').first()).toBeVisible();

  // The second tab never submitted anything, so it is not "done" -- it is a tab
  // holding an authorization that has been used up, and it has to say so.
  await expect(refusal(second)).toBeVisible({ timeout: 15_000 });
  await expect(newPassword(second)).toHaveCount(0);
  expect(await heldGrant(second)).toBe('');
});

test('a spent grant cannot submit while its success broadcast is delayed', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  /*
   * Model the interval after durable revocation but before broadcast delivery.
   * Keep real auth-js, shared storage and Web Locks; suppress only the release
   * announcement.
   *
   * Both shapes are suppressed because the announcement moved. It used to be
   * auth-js's USER_UPDATED, emitted as a side effect of updateUser; the
   * mutation now carries the validated token instead of going through auth-js
   * -- so the correct-account invariant survives a browser with no Web Locks --
   * and the store announces the release itself. Suppressing only the old shape
   * would let the new one through, the second tab's grant would clear, and this
   * would stop staging the stale grant it exists to exercise.
   */
  await first.addInitScript(() => {
    const postMessage = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (message) {
      const isAuthJsRelease = message?.event === 'USER_UPDATED';
      const isStoreRelease = message?.type === 'recovery-spent';
      if (!isAuthJsRelease && !isStoreRelease) postMessage.call(this, message);
    };
  });
  await stubGoTrueUser(first);
  let secondUpdates = 0;
  await stubGoTrueUser(second, async (route) => {
    secondUpdates += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
  });
  await first.goto(recoveryLink());
  await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
  await second.goto(recoveryLink());
  await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });
  await fillNewPassword(second, 'second-tab-password');
  await fillNewPassword(first, 'first-tab-password');
  await submit(first).click();
  await expect(first.getByText('Password updated. You are signed in.').first()).toBeVisible();
  // Confirm the stale grant exists: this must exercise the mutation guard,
  // rather than pass because the notification already disabled the form.
  expect(await heldGrant(second)).toBe(USER_ID);
  await expect(submit(second)).toBeEnabled();
  await submit(second).click();
  await expect(refusal(second)).toBeVisible();
  expect(await heldGrant(second)).toBe('');
  expect(secondUpdates).toBe(0);
});

test('a grant spent by another tab mid-submission never shows this one a refusal', async ({ context }) => {
  /*
   * The window `saving` outranking `refused` exists for, which only became
   * reachable once the mutation stopped taking auth-js's lock.
   *
   * The old shape of this case asserted the lock steal itself: a second tab
   * taking the lock made the first tab's updateUser reject, and the first tab
   * had to be told rather than left on "Saving...". That mechanism is gone by
   * construction -- the mutation is now a request carrying the validated token,
   * so nothing serializes the two tabs -- and asserting it would be asserting a
   * defect that can no longer occur.
   *
   * What that removal makes possible is the case reported twice as unstageable:
   * the second tab can finish and announce WHILE the first is still submitting.
   */
  const first = await context.newPage();
  const second = await context.newPage();
  const firstErrors = recordPageErrors(first);

  let releaseFirst: () => void = () => {};
  const firstUpdateHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let sawFirstUpdate: () => void = () => {};
  const firstUpdateStarted = new Promise<void>((resolve) => {
    sawFirstUpdate = resolve;
  });

  try {
    await stubGoTrueUser(first, async (route) => {
      sawFirstUpdate();
      await firstUpdateHeld;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
    });
    await stubGoTrueUser(second);

    await first.goto(recoveryLink());
    await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
    await second.goto(recoveryLink());
    await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });

    await fillNewPassword(first, 'a-brand-new-password');
    await fillNewPassword(second, 'a-different-new-password');
    // Empty fields here would mean a remount -- a different failure that should
    // say so rather than surfacing later as a missing button.
    await expect(newPassword(first)).toHaveValue('a-brand-new-password');

    await watchScreen(first);
    await submit(first).click();
    await firstUpdateStarted;

    await submit(second).click();
    await expect(second.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => heldGrant(first), { timeout: 15_000 }).toBe('');

    // Grant gone, request still in flight: the moment `saving` has to outrank
    // `refused`.
    releaseFirst();
    await expect(first.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });

    const screens = await observedScreens(first);
    expect(screens.some((state) => state.saving)).toBe(true);
    expect(screens.filter((state) => state.refused)).toEqual([]);
    expect(firstErrors).toEqual([]);
  } finally {
    // A held route outlives a failed assertion and Playwright waits on it in
    // teardown, turning one clear failure into a timeout.
    releaseFirst();
  }
});

test('a recovery link does not drag every other tab to the reset screen', async ({ context }) => {
  /*
   * auth-js broadcasts PASSWORD_RECOVERY to every open tab, so every tab
   * records the grant -- which is correct, and is how a spent grant gets
   * released everywhere. It is not a reason for every tab to NAVIGATE. Opening
   * a recovery link in a new tab used to yank the others to the reset screen,
   * unmounting whatever was in progress there.
   *
   * The tab that opened the link is identified from its own URL, which is safe
   * only because it decides routing alone: the grant still comes from
   * Supabase's validated event, so a forged fragment moves someone to a screen
   * that then refuses them.
   */
  const bystander = await context.newPage();
  const opener = await context.newPage();
  await stubGoTrueUser(bystander);
  await stubGoTrueUser(opener);

  /*
   * The bystander sits on /verify rather than /login on purpose. Login has a
   * redirect of its own -- a session arriving by broadcast signs that tab in
   * and sends it to the workspace, which is correct and long-standing, and
   * would have been mistaken here for the defect under test. /verify is public
   * and has no session-driven navigation, so any movement is this redirect's
   * doing and nothing else's.
   */
  await bystander.goto('/app/verify');
  await expect(bystander.getByText('Verify a sale packet')).toBeVisible({ timeout: 30_000 });

  await opener.goto(recoveryLink());
  await expect(newPassword(opener)).toBeVisible({ timeout: 30_000 });

  // The broadcast did reach the bystander -- so this is not passing because
  // nothing happened.
  await expect.poll(async () => heldGrant(bystander), { timeout: 15_000 }).toBe(USER_ID);

  // And it stayed where the customer left it.
  await expect(bystander).toHaveURL(/\/app\/verify$/);
  await expect(bystander.getByText('Verify a sale packet')).toBeVisible();
  await expect(newPassword(bystander)).toHaveCount(0);
});

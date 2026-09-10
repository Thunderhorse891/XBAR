import { expect, test, type Page } from '@playwright/test';
import {
  RECOVERY_EMAIL,
  RECOVERY_GRANT_KEY,
  RECOVERY_KEY,
  USER_ID,
  blockWebfonts,
  readStoredAccessToken,
  recoveryLink,
  recoverySpentKeyFor,
  recoveryUpdateClaimKeyFor,
  refreshStoredSession,
  refreshedSession,
  sessionIdOf,
  sessionLink,
  stubGoTrueUser,
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

async function heldGrantToken(page: Page) {
  return page.evaluate((key) => window.sessionStorage.getItem(key) ?? '', RECOVERY_GRANT_KEY);
}

async function recoverySpentState(page: Page, userId = USER_ID) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw) as { state?: string };
      return parsed.state ?? raw;
    } catch {
      return raw;
    }
  }, recoverySpentKeyFor(userId));
}

async function expireRecoveryUpdateClaim(page: Page, userId = USER_ID) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const claim = JSON.parse(raw) as { expiresAt?: number };
    claim.expiresAt = Date.now() - 1;
    window.localStorage.setItem(key, JSON.stringify(claim));
    return true;
  }, recoveryUpdateClaimKeyFor(userId));
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
  await expect.poll(() => recoverySpentState(other)).toBe('spent');

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

test('a delayed spent announcement cannot revoke a newly validated recovery', async ({ page }) => {
  await stubGoTrueUser(page);
  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  await fillNewPassword(page, 'first-reset-password');
  await submit(page).click();
  await expect(page.getByText('Password updated. You are signed in.').first()).toBeVisible();

  // Open the new email link in a fresh document, so auth-js parses it again.
  await page.goto('about:blank');
  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  // Deliver an old completion after the new PASSWORD_RECOVERY event. Wait
  // for delivery and rendering before asserting that the fresh form survives.
  await page.evaluate(
    (userId) =>
      new Promise<void>((resolve) => {
        const observer = new BroadcastChannel('xbar-password-recovery');
        const sender = new BroadcastChannel('xbar-password-recovery');
        observer.onmessage = () => {
          observer.close();
          sender.close();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        };
        sender.postMessage({ type: 'recovery-spent', userId });
      }),
    USER_ID,
  );
  expect(await heldGrant(page)).toBe(USER_ID);
  await expect(newPassword(page)).toBeVisible();
  await fillNewPassword(page, 'second-reset-password');
  await submit(page).click();
  await expect(page.getByText('Password updated. You are signed in.').first()).toBeVisible();
});

test('completion of an older reset does not retire a newly validated link', async ({ context }) => {
  /*
   * The durable marker is per account, but the thing being spent is a specific
   * recovery link. If an older password request finishes after a fresh email has
   * already validated for the same account, that older completion must not burn
   * the newer unused link.
   */
  const first = await context.newPage();
  const second = await context.newPage();

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

    const firstLink = recoveryLink();
    const secondLink = recoveryLink();

    await first.goto(firstLink);
    await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
    const firstGrantToken = await heldGrantToken(first);
    expect(firstGrantToken).not.toBe('');

    await fillNewPassword(first, 'first-reset-password');
    await submit(first).click();
    await firstUpdateStarted;

    await second.goto(secondLink);
    await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => heldGrantToken(second), { timeout: 15_000 }).not.toBe(firstGrantToken);

    releaseFirst();
    await expect(first.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });

    expect(await heldGrant(second)).toBe(USER_ID);
    await expect(newPassword(second)).toBeVisible();
    await fillNewPassword(second, 'second-reset-password');
    await submit(second).click();
    await expect(second.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });
  } finally {
    releaseFirst();
  }
});

for (const withoutBroadcastChannel of [false, true]) {
  test(`spending the grant in one tab ends it in the other (BroadcastChannel absent: ${withoutBroadcastChannel})`, async ({
    context,
  }) => {
    if (withoutBroadcastChannel) {
      await context.addInitScript(() => {
        Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true });
      });
    }
    /*
     * Each tab validates a recovery link. Completion must then clear the other
     * tab's form, through the store announcement or the storage-event fallback
     * when BroadcastChannel is unavailable.
     */
    const first = await context.newPage();
    const second = await context.newPage();
    await stubGoTrueUser(first);
    await stubGoTrueUser(second);

    const link = recoveryLink();
    await first.goto(link);
    await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
    await second.goto(link);
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
}

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
  const link = recoveryLink();
  await first.goto(link);
  await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
  await second.goto(link);
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

test('two tabs cannot send the same recovery grant at the same time', async ({ context }) => {
  /*
   * Carrying the validated token fixes the account-selection bug, but it means
   * the mutation no longer passes through auth-js serialization. The app has to
   * reserve the grant before the PUT leaves the browser, or two tabs can race
   * different new passwords and both report success.
   */
  const first = await context.newPage();
  const second = await context.newPage();

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
    let secondUpdates = 0;
    await stubGoTrueUser(second, async (route) => {
      secondUpdates += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
    });

    const link = recoveryLink();
    await first.goto(link);
    await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
    await second.goto(link);
    await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });

    await fillNewPassword(first, 'first-tab-password');
    await fillNewPassword(second, 'second-tab-password');
    await submit(first).click();
    await firstUpdateStarted;

    await submit(second).click();
    await expect(second.getByText('This reset link is already being used in another tab.').first()).toBeVisible({
      timeout: 15_000,
    });
    expect(secondUpdates).toBe(0);

    releaseFirst();
    await expect(first.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });
    await expect(refusal(second)).toBeVisible({ timeout: 15_000 });
  } finally {
    releaseFirst();
  }
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
   * That case is still stageable without reintroducing the defect: another tab
   * can announce the durable grant revocation WHILE the first request is still
   * submitting, and the first screen still must not flip from Saving to
   * "expired link" before its request settles.
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
    let secondUpdates = 0;
    await stubGoTrueUser(second, async (route) => {
      secondUpdates += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
    });

    const link = recoveryLink();
    await first.goto(link);
    await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
    await second.goto(link);
    await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });

    await fillNewPassword(first, 'a-brand-new-password');
    await fillNewPassword(second, 'a-different-new-password');
    // Empty fields here would mean a remount -- a different failure that should
    // say so rather than surfacing later as a missing button.
    await expect(newPassword(first)).toHaveValue('a-brand-new-password');

    await watchScreen(first);
    await submit(first).click();
    await firstUpdateStarted;

    await second.evaluate((id) => {
      localStorage.setItem(`xbar-password-recovery-spent:user:${id}`, 'spent');
      const channel = new BroadcastChannel('xbar-password-recovery');
      channel.postMessage({ type: 'recovery-spent', userId: id });
      channel.close();
    }, USER_ID);
    await expect.poll(async () => heldGrant(first), { timeout: 15_000 }).toBe('');
    expect(secondUpdates).toBe(0);

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

test('two tabs submitting at the same instant still send one change', async ({ context }) => {
  /*
   * The half of the race the sequential case cannot reach.
   *
   * "two tabs cannot send the same recovery grant at the same time" stages the
   * second submission AFTER the first has already written its claim, so it is
   * refused by a claim that is durably there. That leaves the harder case
   * untested: both tabs reading the record before either has written to it.
   * localStorage has no compare-and-set, so the reservation handles this by
   * writing, yielding, and re-reading -- whoever's token is still there owns
   * the claim, and the overwritten tab stands down.
   *
   * Both clicks are started before either is awaited, so the two submissions
   * are in flight together. That is as close to simultaneous as the browser
   * can be driven from here; the assertion below holds either way, and how
   * much of the mechanism this actually exercises is reported on the PR rather
   * than assumed.
   */
  const first = await context.newPage();
  const second = await context.newPage();
  const sent: string[] = [];

  for (const page of [first, second]) {
    // Counted across both pages: the claim is about how many changes reach
    // GoTrue in total, so a request from either tab has to be visible here.
    await page.route('**/auth/v1/user*', async (route) => {
      if (route.request().method() === 'PUT') sent.push(route.request().postData() ?? '');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
    });
  }

  const link = recoveryLink();
  await first.goto(link);
  await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
  await second.goto(link);
  await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });

  await fillNewPassword(first, 'first-tab-password');
  await fillNewPassword(second, 'second-tab-password');

  await Promise.all([submit(first).click(), submit(second).click()]);

  // Exactly one change, and it is one of the two that were actually typed --
  // not a count that would also be satisfied by both submissions failing.
  await expect.poll(() => sent.length, { timeout: 30_000 }).toBe(1);
  expect(sent[0]).toMatch(/first-tab-password|second-tab-password/);

  // One tab succeeded and the other was told, rather than both claiming success.
  const succeeded = await Promise.all(
    [first, second].map((page) => page.getByText('Password updated. You are signed in.').count()),
  );
  expect(succeeded.filter((count) => count > 0)).toHaveLength(1);

  // Settle, then confirm nothing arrived late.
  await expect.poll(() => sent.length, { timeout: 5_000 }).toBe(1);
});

test('an in-flight recovery claim is renewed until the password request settles', async ({ context }) => {
  /*
   * A claim needs a TTL so a crashed tab does not block recovery forever, but a
   * live request must keep extending it. Otherwise a slow mobile PUT can age
   * past the TTL and let another tab send a second password.
   */
  const first = await context.newPage();
  const second = await context.newPage();

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
    let secondUpdates = 0;
    await stubGoTrueUser(second, async (route) => {
      secondUpdates += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
    });

    const link = recoveryLink();
    await first.goto(link);
    await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
    await second.goto(link);
    await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });

    await fillNewPassword(first, 'first-tab-password');
    await fillNewPassword(second, 'second-tab-password');
    await submit(first).click();
    await firstUpdateStarted;

    expect(await expireRecoveryUpdateClaim(second)).toBe(true);
    await expect
      .poll(
        () =>
          second.evaluate((key) => {
            const raw = window.localStorage.getItem(key);
            if (!raw) return false;
            return (JSON.parse(raw) as { expiresAt?: number }).expiresAt! > Date.now();
          }, recoveryUpdateClaimKeyFor(USER_ID)),
        { timeout: 5_000 },
      )
      .toBe(true);

    await submit(second).click();
    await expect(second.getByText('This reset link is already being used in another tab.').first()).toBeVisible({
      timeout: 15_000,
    });
    expect(secondUpdates).toBe(0);

    releaseFirst();
    await expect(first.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });
  } finally {
    releaseFirst();
  }
});

for (const failure of ['network', 500, 502, 504] as const) {
  test(`an ambiguous password update (${failure}) does not leave the link usable`, async ({ page }) => {
    /*
     * The request fails in flight, so whether GoTrue applied it is genuinely
     * unknown. The grant is spent anyway: a retry on the same link could race a
     * request that did arrive, and the two would disagree about the password.
     *
     * That is a deliberate fail-closed choice made when the reservation went in,
     * and it had no test -- the screen wording for it existed while nothing ever
     * drove the screen into that state.
     */
    await stubGoTrueUser(page, async (route) => {
      if (failure === 'network') await route.abort('failed');
      else await route.fulfill({ status: failure, contentType: 'text/html', body: '<h1>Upstream error</h1>' });
    });

    await page.goto(recoveryLink());
    await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
    expect(await heldGrant(page)).toBe(USER_ID);

    await fillNewPassword(page, 'a-brand-new-password');
    await submit(page).click();

    // Told honestly: neither "it worked" nor "it definitely did not".
    await expect(page.getByText(/could not confirm that change/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Password updated. You are signed in.')).toHaveCount(0);

    // And the link is finished durably, not just cleared in this tab: a tab that
    // still holds the grant has to be refused too, and this tab must stay
    // refused after a reload.
    await expect.poll(async () => heldGrant(page), { timeout: 15_000 }).toBe('');
    await expect.poll(() => recoverySpentState(page), { timeout: 15_000 }).toBe('spent');
    await page.reload();
    await expect(refusal(page)).toBeVisible({ timeout: 30_000 });
    await expect(newPassword(page)).toHaveCount(0);
  });
}

for (const withoutWebLocks of [false, true]) {
  test(`two tabs submitting at the same instant still send one change (Web Locks absent: ${withoutWebLocks})`, async ({
    context,
  }) => {
    /*
     * The half of the race the sequential case cannot reach.
     *
     * "two tabs cannot send the same recovery grant at the same time" stages
     * the second submission AFTER the first has written its claim, so it is
     * refused by a claim that is durably there. That never exercises both tabs
     * reading before either writes.
     *
     * Run twice on purpose, because two different mechanisms carry it. Where
     * `navigator.locks` exists the lock decides and the race cannot happen;
     * safari13 is a build target and has none, and there only the durable claim
     * -- write, yield, re-read ownership -- stands between two tabs and two
     * password changes. It remains best effort on that browser: a tab that
     * pauses between reading and writing can still acquire an apparent second
     * ownership, which is named on the PR rather than papered over.
     *
     * Both submissions are driven to a terminal state before the count is
     * asserted. Polling for "one request so far" would return the moment it
     * first saw one and prove nothing about a second arriving later.
     */
    if (withoutWebLocks) {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'locks', { get: () => undefined, configurable: true });
      });
    }

    const link = recoveryLink();
    const first = await context.newPage();
    const second = await context.newPage();
    const sent: string[] = [];

    for (const page of [first, second]) {
      // Counted across both pages: the question is how many changes reached
      // GoTrue in total, so a request from either tab has to be visible here.
      await page.route('**/auth/v1/user*', async (route) => {
        if (route.request().method() === 'PUT') sent.push(route.request().postData() ?? '');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
      });
    }

    await first.goto(link);
    await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
    await second.goto(link);
    await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });

    await fillNewPassword(first, 'first-tab-password');
    await fillNewPassword(second, 'second-tab-password');

    await Promise.all([submit(first).click(), submit(second).click()]);

    /*
     * Every tab has to reach a state it cannot leave: one succeeded, the other
     * was told. Waiting for BOTH is what makes the count below final -- a tab
     * still deciding could yet send something.
     */
    const settled = (page: Page) =>
      expect
        .poll(
          async () => {
            const done = await page.getByText('Password updated. You are signed in.').count();
            if (done > 0) return 'done';
            const refused = await page.getByText(/already being used|already been used/i).count();
            return refused > 0 ? 'refused' : 'pending';
          },
          { timeout: 30_000 },
        )
        .not.toBe('pending');
    await settled(first);
    await settled(second);

    const outcomes = await Promise.all(
      [first, second].map(async (page) =>
        (await page.getByText('Password updated. You are signed in.').count()) > 0 ? 'done' : 'refused',
      ),
    );
    expect(outcomes.filter((outcome) => outcome === 'done')).toHaveLength(1);

    // One grant, one change -- asserted only once neither tab can send again.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/first-tab-password|second-tab-password/);
  });
}

test('a stale claim writer cannot send a second change', async ({ context }) => {
  /*
   * The adversarial schedule, as closely as it can be staged from outside.
   *
   * Two tabs read the claim as absent; one is paused there while the other
   * writes, survives its settle window and starts its request; the paused tab
   * resumes, overwrites the live claim with its stale acquisition, passes its
   * own settle check and sends a second password change.
   *
   * A page cannot be suspended mid-function from out here, so what is
   * reproduced is the second tab's POSITION in that schedule rather than the
   * pause itself: clearing the claim key puts this tab past its "is anyone
   * holding it?" read while the first request is in flight, which is the state
   * its stale write would leave behind, and it then walks the rest of the
   * protocol -- write, settle, re-read, conclude it won -- for real.
   *
   * What this does NOT reproduce: the first tab's record is removed rather
   * than overwritten, so its renewal stops instead of losing ownership. That
   * is immaterial to the property under test, since its request is already in
   * flight and it is the lock rather than the claim that refuses the second
   * tab -- but it is the difference between this and the literal schedule, and
   * it is why this is bounded evidence rather than the race itself.
   *
   * The Web Lock is what refuses it. The lock is held across the whole
   * critical section, so a tab resuming mid-protocol cannot acquire one no
   * matter what the claim record says.
   *
   * Not closed on safari13, which has no Web Locks and which this build
   * targets: the same staging there produces a second request, because a check
   * then a write over localStorage cannot be made atomic. That residual is the
   * server's to close and is named as open on the PR.
   */
  const link = recoveryLink();
  const first = await context.newPage();
  const second = await context.newPage();
  const sent: string[] = [];

  let releaseFirst: () => void = () => {};
  const firstHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let sawFirst: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => {
    sawFirst = resolve;
  });

  try {
    for (const page of [first, second]) {
      await page.route('**/auth/v1/user*', async (route) => {
        if (route.request().method() !== 'PUT') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
          return;
        }
        sent.push(route.request().postData() ?? '');
        if (page === first) {
          sawFirst();
          await firstHeld;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
      });
    }

    await first.goto(link);
    await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
    await second.goto(link);
    await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });

    await fillNewPassword(first, 'first-tab-password');
    await fillNewPassword(second, 'second-tab-password');
    await submit(first).click();
    await firstStarted;

    // The first tab's claim really is there before it is taken away, or this
    // stages nothing.
    expect(
      await second.evaluate((key) => window.localStorage.getItem(key), recoveryUpdateClaimKeyFor(USER_ID)),
    ).not.toBeNull();
    // What the paused tab's stale write leaves behind.
    await second.evaluate((key) => window.localStorage.removeItem(key), recoveryUpdateClaimKeyFor(USER_ID));

    await submit(second).click();
    await expect(second.getByText(/already being used|already been used/i).first()).toBeVisible({ timeout: 30_000 });

    releaseFirst();
    await expect(first.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });

    // One change, from the tab that held the lock.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('first-tab-password');
  } finally {
    releaseFirst();
  }
});

test('a token refresh does not make a spent link look unused', async ({ context }) => {
  /*
   * The runtime half of "the grant identifier survives a refresh", which until
   * now was only read off the source.
   *
   * supabaseClient.ts enables autoRefreshToken, a recovery session is good for
   * an hour, and GoTrue rotates the refresh token alongside the access token --
   * so anything derived from the credential drifts mid-recovery. The sequence
   * below is ordinary: a tab is left on the reset screen and backgrounded, the
   * customer finishes the reset elsewhere, the shared session renews while that
   * tab is not running, and the tab comes back. If what was consumed is tied to
   * the old credential it stops matching, and the tab returns to a working form
   * on a link that has already changed the password.
   */
  const link = recoveryLink();
  const stale = await context.newPage();
  const finisher = await context.newPage();
  const sent: string[] = [];

  await stale.route('**/auth/v1/user*', async (route) => {
    if (route.request().method() === 'PUT') sent.push(route.request().postData() ?? '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
  });
  await stubGoTrueUser(finisher);

  await stale.goto(link);
  await expect(newPassword(stale)).toBeVisible({ timeout: 30_000 });
  expect(await heldGrant(stale)).toBe(USER_ID);
  // Backgrounded and discarded, so it hears nothing that follows.
  await stale.goto('about:blank');

  await finisher.goto(link);
  await expect(newPassword(finisher)).toBeVisible({ timeout: 30_000 });

  /*
   * The refresh happens BEFORE the reset is completed, which is the ordering
   * that matters: the record of what was consumed is then written against the
   * renewed credential while the backgrounded tab still holds the original.
   * A real auth-js refresh -- same link, same session id, a different access
   * token -- driven by auth-js itself rather than written by hand.
   */
  const before = await refreshStoredSession(finisher, sessionIdOf(link));
  expect(before).not.toBe('');
  await expect.poll(async () => readStoredAccessToken(finisher), { timeout: 30_000 }).not.toBe(before);

  await fillNewPassword(finisher, 'a-brand-new-password');
  await submit(finisher).click();
  await expect(finisher.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });

  // The backgrounded tab comes back to a signed-in session and a used link.
  await stale.goto('/app/reset-password');
  await expect(refusal(stale)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(stale)).toHaveCount(0);
  expect(await heldGrant(stale)).toBe('');
  expect(sent).toEqual([]);
});

test('an earlier grant stays revoked after a later one is spent', async ({ context }) => {
  /*
   * Revocations have to accumulate. The per-account marker is a single slot, so
   * it only remembers the last thing that happened: after link A was spent and
   * then link B was spent, the marker said "spent, B" -- which rejects B and
   * says nothing about A. A tab still holding A, unloaded through both, came
   * back to a marker that no longer revoked it and could change the password
   * with no new link.
   */
  const linkA = recoveryLink();
  const held = await context.newPage();
  const worker = await context.newPage();
  const sent: string[] = [];

  await held.route('**/auth/v1/user*', async (route) => {
    if (route.request().method() === 'PUT') sent.push(route.request().postData() ?? '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
  });
  await stubGoTrueUser(worker);

  await held.goto(linkA);
  await expect(newPassword(held)).toBeVisible({ timeout: 30_000 });
  expect(await heldGrant(held)).toBe(USER_ID);
  // Unloaded before either reset completes, so it hears neither.
  await held.goto('about:blank');

  // A is spent, then a newly issued B is validated and spent too.
  for (const link of [linkA, recoveryLink()]) {
    await worker.goto(link);
    await expect(newPassword(worker)).toBeVisible({ timeout: 30_000 });
    await fillNewPassword(worker, 'a-brand-new-password');
    await submit(worker).click();
    await expect(worker.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });
    await worker.goto('about:blank');
  }

  // The tab still holding A comes back. B's completion did not un-revoke A.
  await held.goto('/app/reset-password');
  await expect(refusal(held)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(held)).toHaveCount(0);
  expect(await heldGrant(held)).toBe('');
  expect(sent).toEqual([]);
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

test('a session ending in a tab that holds no grant still ends the recovery', async ({ context }) => {
  /*
   * The tab whose session ends is often not the tab holding the grant.
   *
   * A tab opened AFTER a recovery shares the session but has no
   * `passwordRecoveryFor` of its own, so revoking only the grant that tab holds
   * recorded nothing at all. An ordinary same-account sign-in afterwards then
   * restored a session, and the recovery tab -- unloaded throughout, and so
   * reachable by no broadcast -- came back to a live session matching its stale
   * grant, able to set the password again with no new link.
   *
   * The session is deliberately present at the end. Clearing a grant when the
   * bootstrap settles with no session is a different guard, covered by
   * "restoring a recovery tab without a session discards its old grant"; it
   * cannot help here, and this test fails if that is all that stands behind the
   * refusal.
   *
   * The session is ended by a refresh that GoTrue rejects -- what a customer
   * sees when the account is signed out from another device, or the refresh
   * token is revoked. auth-js reaches SIGNED_OUT through its own code here,
   * which is what distinguishes this from "a sign-out event without a local
   * grant revokes an unloaded recovery tab" above: that one delivers the
   * cross-tab message directly and so pins the protocol, while this one holds
   * only if auth-js really does end the session on a refusal the test did not
   * shape. The Settings sign-out button is not used because it sits behind
   * workspace setup, which would drag a cloud workspace save into a test about
   * recovery grants.
   */
  const otherAccount = '9f0a1c22-0000-4000-8000-0000000000ff';
  const recoveryTab = await context.newPage();
  await stubGoTrueUser(recoveryTab);
  await recoveryTab.goto(recoveryLink());
  await expect(newPassword(recoveryTab)).toBeVisible({ timeout: 30_000 });
  expect(await heldGrant(recoveryTab)).toBe(USER_ID);

  // A revocation already on record for a DIFFERENT account. Revoking this one
  // must not take that one with it -- a single durable slot did exactly that
  // once already.
  await recoveryTab.evaluate((key) => window.localStorage.setItem(key, 'spent'), recoverySpentKeyFor(otherAccount));

  /*
   * The recovery tab is unloaded: backgrounded and discarded, the one state in
   * which no broadcast, storage event or channel message can reach it. Its
   * sessionStorage -- and so its grant -- survives that, which is exactly why
   * the revocation has to be recorded somewhere durable and shared.
   */
  await recoveryTab.goto('about:blank');

  const otherTab = await context.newPage();
  await stubGoTrueUser(otherTab);
  // GoTrue refusing the refresh token: the session is over and cannot be renewed.
  await otherTab.route('**/auth/v1/token*', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }),
    }),
  );

  // Public, and opened after the recovery: it shares the session and holds no
  // grant of its own -- the exact tab whose sign-out used to record nothing.
  await otherTab.goto('/app/verify');
  await expect(otherTab.getByText('Verify a sale packet')).toBeVisible({ timeout: 30_000 });
  expect(await heldGrant(otherTab)).toBe('');

  const expired = await otherTab.evaluate(() => {
    const key = Object.keys(window.localStorage).find(
      (entry) => entry.startsWith('sb-') && entry.endsWith('-auth-token'),
    );
    if (!key) return false;
    const stored = JSON.parse(window.localStorage.getItem(key) ?? '{}') as { expires_at?: number; expires_in?: number };
    stored.expires_at = Math.floor(Date.now() / 1000) - 60;
    stored.expires_in = 0;
    window.localStorage.setItem(key, JSON.stringify(stored));
    // What the browser does when the customer returns to a backgrounded tab:
    // auth-js recovers the stored session, finds it expired, and tries to renew.
    window.dispatchEvent(new Event('visibilitychange'));
    return true;
  });
  // It really was signed in here, or there would have been no session to end.
  expect(expired).toBe(true);

  // auth-js gave up on the session: this tab is signed out.
  await expect
    .poll(
      async () =>
        otherTab.evaluate(() =>
          Object.keys(window.localStorage).some((key) => key.startsWith('sb-') && key.endsWith('-auth-token')),
        ),
      {
        timeout: 30_000,
      },
    )
    .toBe(false);

  // And the account was revoked durably, by a tab that never held the grant.
  await expect.poll(() => recoverySpentState(otherTab), { timeout: 30_000 }).toBe('spent');

  // An ordinary sign-in to the same account, with no recovery link of any kind.
  await otherTab.goto(sessionLink('signin'));
  await expect(refusal(otherTab)).toBeVisible({ timeout: 30_000 });

  // And the recovery tab comes back.
  await recoveryTab.goto('/app/reset-password');
  await expect(refusal(recoveryTab)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(recoveryTab)).toHaveCount(0);
  expect(await heldGrant(recoveryTab)).toBe('');

  // It really did come back to a live session, so the refusal is the
  // revocation's doing and not the absence of a session.
  expect(
    await recoveryTab.evaluate(() =>
      Object.keys(window.localStorage).some((key) => key.startsWith('sb-') && key.endsWith('-auth-token')),
    ),
  ).toBe(true);

  // The other account's revocation survived this one.
  expect(await recoverySpentState(recoveryTab, otherAccount)).toBe('spent');
});

/*
 * Site data blocked outright: reading `localStorage` at all throws, which is
 * what a browser configured to block storage actually does -- it does not hand
 * back an empty store.
 */
async function blockSiteData(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access to storage is not allowed from this context.', 'SecurityError');
      },
    });
  });
}

test('a recovery still completes when site data is blocked', async ({ page }) => {
  /*
   * auth-js falls back to an in-memory adapter here and establishes a
   * perfectly valid recovery session, so the link works and the form is
   * reachable. The claim written before the password request did not fall
   * back: it treated writable localStorage as a precondition and refused every
   * submission as "could not safely reserve", even with a real Web Lock held.
   * A protection causing exactly the lockout it exists to prevent.
   */
  await blockSiteData(page);
  let updates = 0;
  await stubGoTrueUser(page, async (route) => {
    updates += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
  });

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  await fillNewPassword(page, 'a-brand-new-password');
  await submit(page).click();

  await expect(page.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });
  // The password really changed, rather than the screen saying so.
  expect(updates).toBe(1);
});

test('a recovery completed with site data blocked still stops an open second tab', async ({ context }) => {
  /*
   * What the degraded path can and cannot do.
   *
   * CAN: the spent announcement is a BroadcastChannel message and uses no
   * storage at all, so a tab that is OPEN still learns the grant is over.
   * Each tab keeps its own in-memory session here, since auth-js cannot share
   * one through blocked storage -- both establish theirs from the same link.
   *
   * CANNOT, and this is not covered because it is not true: nothing survives a
   * reload. A tab reloaded after this has no record that the grant was spent.
   * That limit is inherent to having no durable store, and is recorded in the
   * source rather than tested away.
   */
  const first = await context.newPage();
  const second = await context.newPage();
  await blockSiteData(first);
  await blockSiteData(second);
  await stubGoTrueUser(first);
  let secondUpdates = 0;
  await stubGoTrueUser(second, async (route) => {
    secondUpdates += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
  });

  const link = recoveryLink();
  await first.goto(link);
  await expect(newPassword(first)).toBeVisible({ timeout: 30_000 });
  await second.goto(link);
  await expect(newPassword(second)).toBeVisible({ timeout: 30_000 });

  await fillNewPassword(second, 'second-tab-password');
  await fillNewPassword(first, 'first-tab-password');
  await submit(first).click();
  await expect(first.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });

  await expect(refusal(second)).toBeVisible({ timeout: 30_000 });
  expect(secondUpdates).toBe(0);
});

test('a link replaced while its tab was away is still dead when the tab comes back', async ({ context }) => {
  /*
   * The generation the marker forgot.
   *
   * The per-account marker holds ONE generation. Validating link B over an
   * unspent link A wrote `active:B`, and that was the end of A's record. The
   * accumulated per-grant keys were written only for a grant that was
   * CONSUMED, and A never was -- it was displaced.
   *
   * Getting this to bite took three attempts, and the two that failed are why
   * the staging looks like this. A tab that is RUNNING is safe either way: at
   * the moment `active:B` is written, A reads as revoked -- an account marker
   * naming a different generation revokes every other one -- and the tab drops
   * its grant, through the broadcast or the storage event. The hole opens only
   * once B is SPENT, because `spent:B` says nothing at all about A. A tab that
   * saw that transition is already safe; a tab that was away for it is not.
   *
   * So this tab leaves for a page that does not run the app -- the marketing
   * site, same origin, so its sessionStorage grant survives -- and comes back
   * afterwards. What decides it then is the written record, and
   * `hasValidatedPasswordRecovery` compares only the account, so that record is
   * the whole defence.
   */
  const older = await context.newPage();
  const newer = await context.newPage();
  await stubGoTrueUser(newer);
  let olderUpdates = 0;
  await stubGoTrueUser(older, async (route) => {
    olderUpdates += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
  });

  const first = recoveryLink();
  const second = recoveryLink();
  expect(sessionIdOf(first)).not.toBe(sessionIdOf(second));

  await older.goto(first);
  await expect(newPassword(older)).toBeVisible({ timeout: 30_000 });
  const olderGrant = await heldGrantToken(older);
  expect(olderGrant).not.toBe('');

  // Away, and listening to nothing.
  await older.goto('/');
  expect(await heldGrantToken(older)).toBe(olderGrant);

  // A second reset email, requested because the first seemed not to arrive,
  // and completed while the first tab was elsewhere.
  await newer.goto(second);
  await expect(newPassword(newer)).toBeVisible({ timeout: 30_000 });
  await fillNewPassword(newer, 'newer-tab-password');
  await submit(newer).click();
  await expect(newer.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });

  // Back, still holding a link that was replaced. It must not open the form,
  // and must not be able to change the password.
  await older.goto('/app/reset-password');
  await expect(refusal(older)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(older)).toHaveCount(0);
  expect(await heldGrant(older)).toBe('');
  expect(olderUpdates).toBe(0);
});

test('a full storage quota does not wedge a reset behind a stale claim', async ({ page }) => {
  /*
   * localStorage readable, its writes rejected -- a full quota, which is the
   * common shape and not the same as blocked site data.
   *
   * The in-flight claim written before a password request could then never
   * replace an expired one left behind by an earlier attempt: the new claim
   * reached memory only, the settle re-read preferred the older PERSISTED
   * value, and the link reported "already being used in another tab" on every
   * attempt, forever. The overlay only outranks the durable store where the
   * durable store is known to be behind, which is exactly here.
   */
  const claimKey = recoveryUpdateClaimKeyFor(USER_ID);
  await page.addInitScript(
    ({ key, stale }) => {
      // Seeded while writes still work: the leftover of an attempt that died
      // before it could clear its claim.
      window.localStorage.setItem(key, stale);
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (...args: [string, string]) {
        if (this === window.localStorage) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        return setItem.apply(this, args);
      };
    },
    { key: claimKey, stale: JSON.stringify({ token: 'a-dead-attempt', expiresAt: Date.now() - 1 }) },
  );

  let updates = 0;
  await stubGoTrueUser(page, async (route) => {
    updates += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
  });

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  await fillNewPassword(page, 'a-brand-new-password');
  await submit(page).click();

  await expect(page.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });
  expect(updates).toBe(1);
});

test('a completion that lands after a newer link cannot erase that link from the record', async ({ context }) => {
  /*
   * The account marker holds ONE generation, and an update that finishes after
   * a newer link has been validated used to replace `active:B` with `spent:A`.
   *
   * Nothing breaks immediately -- B's grant id still differs from A's, so B's
   * own form survives. What is lost is the RECORD that B is the current
   * generation, so when a later link C displaces it, C revokes A (again) and
   * never B. A tab still holding B then comes back to a live form.
   *
   * A's request has to be in flight BEFORE B is validated, because validating
   * B revokes A -- so it is held open, which is also what a slow network does.
   */
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  const tabC = await context.newPage();

  let releaseA: (() => void) | undefined;
  const aInFlight = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  await stubGoTrueUser(tabA, async (route) => {
    await aInFlight;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
  });
  await stubGoTrueUser(tabB);
  await stubGoTrueUser(tabC);

  const linkA = recoveryLink();
  const linkB = recoveryLink();
  const linkC = recoveryLink();

  await tabA.goto(linkA);
  await expect(newPassword(tabA)).toBeVisible({ timeout: 30_000 });
  await fillNewPassword(tabA, 'first-link-password');
  // Sent, and held by GoTrue rather than answered.
  await submit(tabA).click();

  await tabB.goto(linkB);
  await expect(newPassword(tabB)).toBeVisible({ timeout: 30_000 });

  // Now A settles, late.
  releaseA?.();
  await expect(tabA.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });

  // B's holder goes elsewhere, so only the written record can speak for it.
  await tabB.goto('/');

  // A third link arrives and is completed. It must be able to find B and end
  // it -- which it can only do if the marker still said B was current.
  await tabC.goto(linkC);
  await expect(newPassword(tabC)).toBeVisible({ timeout: 30_000 });
  await fillNewPassword(tabC, 'third-link-password');
  await submit(tabC).click();
  await expect(tabC.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });

  // B comes back to a link that has been superseded twice over.
  await tabB.goto('/app/reset-password');
  await expect(refusal(tabB)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(tabB)).toHaveCount(0);
});

test('a rejected callback explains itself on the browser router too', async ({ page }) => {
  /*
   * The PRODUCTION router. Nothing is unreachable here -- `/app/login` renders
   * fine -- which is why this was easy to miss: the customer got an ordinary
   * sign-in form with no hint that their link had failed. auth-js leaves the
   * fragment in place and emits nothing, so unless something moves the reason
   * where a screen can read it, nothing ever says what happened.
   */
  await stubGoTrueUser(page);
  await page.goto('/app/login#error=access_denied&error_code=otp_expired&error_description=Email+link+has+expired');

  await expect(page.getByText('Email link has expired')).toBeVisible({ timeout: 30_000 });
  // Still the sign-in screen, which is where they need to be.
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('a rejected callback is still readable when a session is already live', async ({ page }) => {
  /*
   * auth-js keeps an existing valid session when a URL login is REJECTED, so
   * an expired link opened while this browser is already signed in arrives at
   * a screen whose job is to redirect signed-in visitors away. It did exactly
   * that, and the explanation was unmounted before it could be read -- a
   * failed link that looked like a success.
   */
  const link = recoveryLink();
  await stubGoTrueUser(page);
  await page.goto(link);
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  // Signed in on this device, then a second link that Supabase rejects.
  await page.goto('/app/login#error=access_denied&error_description=Email+link+has+expired');
  await expect(page.getByText('Email link has expired')).toBeVisible({ timeout: 30_000 });

  /*
   * And it STAYS. Polled rather than sampled: the defect is a redirect that
   * fires a moment later, so an immediate assertion would pass over it.
   */
  await page.waitForTimeout(3000);
  await expect(page.getByText('Email link has expired')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/app/login');
});

test('signing in after a failed callback actually leaves the sign-in screen', async ({ page }) => {
  /*
   * The hold that keeps a callback failure readable must not outlive it.
   *
   * A cancelled consent or expired link parks the customer here with an
   * explanation, and the redirect is suppressed so the message survives. It
   * was only released when the MODE changed -- so someone who simply signed in
   * again sat on the sign-in screen watching "signed in" with the redirect
   * still held, until they reloaded.
   */
  await stubGoTrueUser(page);
  await page.route('**/auth/v1/token*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(refreshedSession('after-failed-callback')),
    }),
  );

  await page.goto('/app/login#error=access_denied&error_description=Email+link+has+expired');
  await expect(page.getByText('Email link has expired')).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('Email').fill(RECOVERY_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill('a-real-password');
  await page.getByRole('button', { name: /Sign In/i }).click();

  // Off the sign-in screen. Polled, because the defect is a redirect that is
  // suppressed rather than one that is slow.
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).not.toBe('/app/login');
});

test('a refused retry after a failed callback does not carry the old account through', async ({ page }) => {
  /*
   * The hold must survive a REFUSED attempt.
   *
   * A rejected callback can arrive while an existing session is still valid --
   * auth-js keeps one when a URL login fails -- so the screen is held with an
   * explanation while somebody is, technically, still signed in. Releasing the
   * hold on any outcome meant that typing another account's password WRONGLY
   * released it, and the redirect then carried them into the OLD account's
   * workspace: the new error hidden, and a refused attempt looking like a
   * successful sign-in.
   */
  await stubGoTrueUser(page);

  // A live session first, so the redirect has somewhere to carry them.
  await page.goto(sessionLink('signin'));
  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });

  await page.goto('/app/login#error=access_denied&error_description=Email+link+has+expired');
  await expect(page.getByText('Email link has expired')).toBeVisible({ timeout: 30_000 });

  // Another account, wrong password.
  await page.route('**/auth/v1/token*', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }),
    }),
  );
  await page.getByLabel('Email').fill('someone-else@xbar.test');
  await page.getByLabel('Password', { exact: true }).fill('the-wrong-password');
  await page.getByRole('button', { name: /Sign In/i }).click();

  // The refusal is shown, and they are still here to read it.
  await expect(page.getByText(/Invalid login credentials/i).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  expect(new URL(page.url()).pathname).toBe('/app/login');
});

test('sending reset mail after a failed callback does not release the screen', async ({ page }) => {
  /*
   * A success that signs NOBODY in must not end the hold.
   *
   * Releasing on any `ok` result looked right until you count what actually
   * passes through: sending reset mail, requesting a code and resending a
   * confirmation all succeed without touching the session. So a customer
   * parked here by a rejected link -- with an older session still live,
   * because auth-js keeps one when a URL login fails -- who pressed "Forgot
   * password?" was carried straight into the OLD account, and the
   * "Check your inbox" they had just asked for went with the screen.
   */
  await stubGoTrueUser(page);

  // A live session first, so the redirect has somewhere to carry them.
  await page.goto(sessionLink('signin'));
  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });

  await page.goto('/app/login#error=access_denied&error_description=Email+link+has+expired');
  await expect(page.getByText('Email link has expired')).toBeVisible({ timeout: 30_000 });

  // The reset request itself succeeds.
  await page.route('**/auth/v1/recover*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.getByLabel('Email').fill(RECOVERY_EMAIL);
  await page.getByRole('button', { name: /Forgot password\?/i }).click();

  /*
   * The answer is readable, and it STAYS readable. Polled rather than sampled:
   * the defect is a redirect that fires a moment later.
   */
  await expect(page.getByText(/Check your inbox|password reset|If that address/i).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(2500);
  expect(new URL(page.url()).pathname).toBe('/app/login');
});

test('switching modes after a failed callback does not carry the old account through', async ({ page }) => {
  /*
   * Changing modes is not a decision to resume the existing session.
   *
   * The hold predates the funnel: it was originally released in `setMode`,
   * on the reasoning that somebody who had switched modes had read the
   * message and moved on. Clearing the MESSAGE there is right. Clearing the
   * REDIRECT SUPPRESSION is not -- with an older session still live, pressing
   * "Create account" released the hold, and because `redirectTarget` is
   * `/setup` in signup mode the customer was carried into the OLD account's
   * setup instead of being shown a signup form.
   */
  await stubGoTrueUser(page);

  // A live session first, so the redirect has somewhere to carry them.
  await page.goto(sessionLink('signin'));
  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });

  await page.goto('/app/login#error=access_denied&error_description=Email+link+has+expired');
  await expect(page.getByText('Email link has expired')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /^Create account$/i }).click();

  // Still on the sign-in screen, now offering signup. Polled, because the
  // defect is a redirect that fires a moment after the mode change.
  await page.waitForTimeout(2500);
  expect(new URL(page.url()).pathname).toBe('/app/login');
});

test('a sign-out a newer recovery has already overtaken does not revoke it', async ({ page }) => {
  /*
   * auth-js broadcasts SIGNED_OUT to every tab, and the RECEIVING tab's handler
   * is `_notifyAllSubscribers(event, session, false)` -- it does not remove that
   * tab's session. So a sign-out in another tab, delivered after this one has
   * validated a NEW recovery link, arrived describing a session this tab no
   * longer has, and this tab permanently recorded its own unused grant as
   * spent: the customer's link reported as already used, with no way back
   * except another email.
   *
   * The broadcast is posted directly on auth-js's own channel, which is keyed
   * on the storage key -- that is the real delivery path, not a simulation of
   * one, and it is what makes the event genuinely STALE: nothing has touched
   * the stored session, exactly as when the sign-out happened before this
   * recovery existed.
   */
  await stubGoTrueUser(page);
  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  const delivered = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return false;
    new BroadcastChannel(key).postMessage({ event: 'SIGNED_OUT', session: null });
    return true;
  });
  expect(delivered).toBe(true);

  /*
   * The form is still here and still usable. Polled rather than sampled: the
   * revocation happened a moment after the broadcast landed.
   */
  await page.waitForTimeout(2500);
  await expect(newPassword(page)).toBeVisible();
  await expect(refusal(page)).toHaveCount(0);
});

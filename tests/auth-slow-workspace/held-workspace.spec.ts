import { expect, test, type Page, type Route } from '@playwright/test';
import {
  blockWebfonts,
  recoveryLink,
  RECOVERY_KEY,
  refreshStoredSession,
  SECOND,
  SECOND_USER_ID,
  sessionLink,
  stubGoTrueUser,
  USER_ID,
} from '../auth-smoke/support.js';

/*
 * Setting a password while the workspace API is unreachable.
 *
 * `status` stays 'loading' until the store has loaded a workspace profile, and
 * with relational sync on -- the production default, and what this bundle
 * builds -- that means PostgREST queries against `workspaces`,
 * `workspace_memberships` and `workspace_invitations`. The reset screen read
 * `status` for "is the link still arriving?", so a validated recovery sat
 * behind fetches it has no use for: slow or failed workspace API, no password
 * form, and a reload did the same thing again, while GoTrue was healthy enough
 * to accept the change.
 *
 * These requests are held open rather than failed, which is the worse case --
 * a rejection settles, a hang does not.
 *
 * The auth-smoke suite cannot express any of this: its bundle pins relational
 * sync OFF, so no workspace request is ever made there.
 */

blockWebfonts();

const WORKSPACE_REST = /\/rest\/v1\/(workspaces|workspace_memberships|workspace_invitations)/;
const SNAPSHOT_REST = /\/rest\/v1\/workspace_snapshots/;
// The first relational table a hydration reads, and the one whose URL carries
// the workspace it decided to read -- which is the whole question on a switch.
const HORSES_REST = /\/rest\/v1\/horses/;
const WORKSPACE_ID = '7f1d0c44-0000-4000-8000-0000000000aa';
const SECOND_WORKSPACE_ID = '7f1d0c44-0000-4000-8000-0000000000bb';

const refusal = (page: Page) => page.getByText(/This page needs a current password-reset link/);
const newPassword = (page: Page) => page.getByLabel('New password', { exact: true });
const submit = (page: Page) => page.getByRole('button', { name: 'Set new password' });

async function fillNewPassword(page: Page, value: string) {
  await newPassword(page).fill(value);
  await page.getByLabel('Confirm new password').fill(value);
}

/*
 * Holds every workspace request open until released, and counts them, so a
 * test can prove the hang was real rather than passing because nothing was
 * ever requested.
 */
async function holdWorkspaceApi(page: Page, { holding = true, only = '' } = {}) {
  const held: Route[] = [];
  const owners: string[] = [];
  let releasing = !holding;
  await page.route(WORKSPACE_REST, async (route) => {
    const owner = ownerOf(route.request().url());
    owners.push(owner);
    // `only` holds ONE account's requests and answers everyone else's, so a
    // session that arrives while an obsolete one hangs can be seen to resolve
    // on its own rather than behind it.
    if (releasing || (only && owner !== only)) {
      await fulfilWorkspace(route);
      return;
    }
    held.push(route);
  });
  return {
    get count() {
      return held.length;
    },
    // Which account each held request was asking about, so a switch can be
    // shown to have reached this tab rather than assumed.
    get owners() {
      return owners;
    },
    // Start holding again, so a test can let a tab settle first and only then
    // make the workspace API unreachable.
    hold() {
      releasing = false;
    },
    async release() {
      releasing = true;
      const pending = held.splice(0, held.length);
      for (const route of pending) await fulfilWorkspace(route).catch(() => {});
    },
  };
}

async function fulfilWorkspace(route: Route) {
  const url = route.request().url();
  // `workspaces` is read with maybeSingle(), which wants an object; the other
  // two are list reads. Each account owns a DIFFERENT workspace, so a result
  // applied to the wrong session is visible rather than indistinguishable.
  const body = url.includes('/workspaces?')
    ? JSON.stringify({ id: url.includes(SECOND_USER_ID) ? SECOND_WORKSPACE_ID : WORKSPACE_ID })
    : '[]';
  await route.fulfill({ status: 200, contentType: 'application/json', body });
}

// `owner_user_id=eq.<uuid>` on the workspaces read; the membership reads carry
// `user_id` instead. Either way the account is in the query string.
function ownerOf(url: string) {
  return url.includes(SECOND_USER_ID) ? SECOND_USER_ID : USER_ID;
}

/*
 * The remote read hydration makes, holdable, so a test can interrupt a
 * hydration that is genuinely in flight rather than one that has already
 * finished.
 */
async function holdSnapshotApi(page: Page) {
  const held: Route[] = [];
  const seen: string[] = [];
  let releasing = false;
  await page.route(SNAPSHOT_REST, async (route) => {
    seen.push(route.request().url());
    if (releasing) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    held.push(route);
  });
  return {
    get count() {
      return seen.length;
    },
    async release() {
      releasing = true;
      const pending = held.splice(0, held.length);
      for (const route of pending) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
      }
    },
  };
}

const heldGrant = (page: Page) => page.evaluate((key) => window.sessionStorage.getItem(key) ?? '', RECOVERY_KEY);

test('a validated recovery reaches the form while the workspace API hangs', async ({ page }) => {
  const workspace = await holdWorkspaceApi(page);
  await stubGoTrueUser(page);

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  // The hang is real: the store asked, and is still waiting. Polled because
  // the form renders off the published session, which lands before the
  // request it does not wait for.
  await expect.poll(() => workspace.count, { timeout: 30_000 }).toBeGreaterThan(0);

  await fillNewPassword(page, 'a-brand-new-password');
  await submit(page).click();
  await expect(page.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });

  // Still waiting when the password was changed, which is the point.
  expect(workspace.count).toBeGreaterThan(0);
  await workspace.release();
});

test('reloading while the workspace API hangs still reaches the form', async ({ page }) => {
  const workspace = await holdWorkspaceApi(page);
  await stubGoTrueUser(page);

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  // auth-js has persisted the session and cleared the fragment, so this is the
  // reload a customer does when the first attempt seems stuck.
  await page.reload();
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  expect(await heldGrant(page)).not.toBe('');

  await fillNewPassword(page, 'a-brand-new-password');
  await submit(page).click();
  await expect(page.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });
  await workspace.release();
});

test('releasing the workspace API hydrates once, for the workspace it resolved', async ({ page }) => {
  const workspace = await holdWorkspaceApi(page);
  const snapshotReads: string[] = [];
  await page.route(SNAPSHOT_REST, async (route) => {
    snapshotReads.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await stubGoTrueUser(page);

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  /*
   * Nothing may hydrate while the profile is unresolved. Publishing the
   * session early is what makes the form reachable, and it is also what could
   * have started hydration against an empty workspace id -- then started again
   * when the real one arrived.
   */
  expect(snapshotReads).toEqual([]);

  await workspace.release();
  await page.waitForTimeout(4000);

  /*
   * Exactly one. Two would mean the transient unresolved window cleared the
   * hydration key and the same user and workspace hydrated once per sync --
   * which is what happened before this suite existed, and what it caught.
   */
  expect(snapshotReads).toHaveLength(1);
  // For the account the profile resolved for, not some other one.
  expect(snapshotReads[0]).toContain(USER_ID);
});

test('a session ending while the workspace API hangs authorizes nothing', async ({ page }) => {
  const workspace = await holdWorkspaceApi(page);
  await stubGoTrueUser(page);
  await page.route('**/auth/v1/token*', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }),
    }),
  );

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  /*
   * The session ends underneath a form that is only on screen because the
   * workspace fetch was skipped. Reaching the form earlier must not mean
   * holding authorization longer.
   */
  await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) throw new Error('Expected a stored session');
    const stored = JSON.parse(window.localStorage.getItem(key) ?? '{}') as { expires_at?: number };
    stored.expires_at = Math.floor(Date.now() / 1000) - 60;
    window.localStorage.setItem(key, JSON.stringify(stored));
    window.dispatchEvent(new Event('visibilitychange'));
  });

  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(page)).toHaveCount(0);
  expect(await heldGrant(page)).toBe('');
  await workspace.release();
});

test('an account switch while the workspace API hangs hydrates only the new account', async ({ page, context }) => {
  const workspace = await holdWorkspaceApi(page);
  const relationalReads: string[] = [];
  await page.route(HORSES_REST, async (route) => {
    relationalReads.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await stubGoTrueUser(page);

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  // Polled: the form renders off the published session, which lands before the
  // profile request it deliberately does not wait for.
  await expect.poll(() => workspace.owners, { timeout: 30_000 }).toContain(USER_ID);
  expect(relationalReads).toEqual([]);

  /*
   * A second tab signs a DIFFERENT account in while this tab's workspace fetch
   * is still outstanding. auth-js carries that to this tab over its own
   * cross-tab channel, so the switch is delivered the way a customer's is --
   * not written into this tab's store by the test.
   */
  const second = await context.newPage();
  await stubGoTrueUser(second, undefined, SECOND);
  await second.route(WORKSPACE_REST, fulfilWorkspace);
  await second.goto(sessionLink('signin', SECOND));
  await expect(refusal(second)).toBeVisible({ timeout: 30_000 });

  // Still nothing hydrated: the first account's profile has not resolved, and
  // the second account's arrived while this tab was still bootstrapping.
  expect(relationalReads).toEqual([]);

  /*
   * And the form is gone ALREADY -- while the workspace API is still hanging.
   *
   * The switch can only be QUEUED here: the bootstrap has not finished, so the
   * workspace replay waits. Queuing the identity with it left the store
   * describing the first account, so the grant still matched, and the password
   * form stayed live for a session this browser no longer held -- for as long
   * as the hanging request took, which is forever. Publishing identity
   * separately from its workspace is what retires it now.
   */
  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });
  await expect(newPassword(page)).toHaveCount(0);

  await workspace.release();
  await page.waitForTimeout(4000);

  /*
   * The switch reached this tab -- it went on to ask about the second account.
   * Asserted so a failure below reads as "hydrated wrongly" rather than "the
   * broadcast never arrived", which would fail the same assertions.
   */
  expect(workspace.owners).toContain(SECOND_USER_ID);

  /*
   * The first account's profile resolved AFTER it was superseded, and must be
   * dropped rather than committed.
   *
   * The COUNT is what carries this. Measured, not assumed: dropping
   * `syncGate.retireInFlight()` from the queue path produces two hydrations
   * here. It does not produce a read against the first account's workspace,
   * because relational hydration re-derives the workspace from its own profile
   * fetch rather than from the store -- so the two assertions below are true,
   * and are not what would catch a stale commit. They pin the account the
   * hydration ran for; the count pins that it ran once.
   */
  expect(relationalReads).toHaveLength(1);
  expect(relationalReads[0]).toContain(SECOND_WORKSPACE_ID);
  expect(relationalReads[0]).not.toContain(WORKSPACE_ID);
});

test('switching accounts in a hydrated tab locks its records until the new profile resolves', async ({
  page,
  context,
}) => {
  // Unheld to begin with: this tab must genuinely finish hydrating as the
  // first account before the switch, or it is not the case being tested.
  const workspace = await holdWorkspaceApi(page, { holding: false });
  const relationalReads: string[] = [];
  const promotions: string[] = [];
  await page.route(HORSES_REST, async (route) => {
    relationalReads.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  // Reconciliation's own write. Nothing may push records anywhere while the
  // account on screen and the workspace behind it disagree.
  await page.route(SNAPSHOT_REST, async (route) => {
    if (route.request().method() !== 'GET') promotions.push(route.request().method());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await stubGoTrueUser(page);

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => relationalReads.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(relationalReads[0]).toContain(WORKSPACE_ID);

  // Settled as the first account. Now the workspace API goes away, and a
  // second account signs in.
  relationalReads.length = 0;
  promotions.length = 0;
  workspace.hold();

  const second = await context.newPage();
  await stubGoTrueUser(second, undefined, SECOND);
  await second.route(WORKSPACE_REST, fulfilWorkspace);
  await second.goto(sessionLink('signin', SECOND));
  await expect(refusal(second)).toBeVisible({ timeout: 30_000 });

  /*
   * The identity changed, so this tab must stop treating the previous
   * account's workspace as current. Publishing the new session while leaving
   * `status: 'signed-in'` and the old workspace id in place produced a hybrid:
   * the old account's records stayed interactive under the new identity, and a
   * workspace-scoped write would have carried the old workspace id with the
   * new access token.
   */
  await expect(refusal(page)).toBeVisible({ timeout: 30_000 });
  // Wait for the store's own profile request before counting, then let time
  // pass to see whether anything ELSE asks.
  await expect
    .poll(() => workspace.owners.filter((owner) => owner === SECOND_USER_ID).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  expect(relationalReads).toEqual([]);
  expect(promotions).toEqual([]);

  /*
   * Exactly one request about the new account: the store's own profile fetch.
   *
   * A relational read cannot show this on its own -- hydration re-derives the
   * workspace from a profile fetch of its own, and that fetch is held too, so
   * a hydration that should never have started looks identical from the
   * horses route. It is not identical here: leaving `status: 'signed-in'` and
   * the old workspace id in place gives CloudBootstrap a NEW key
   * (new account, previous workspace) and it begins reconciling, which asks
   * again. One means nothing but the store has moved.
   */
  expect(workspace.owners.filter((owner) => owner === SECOND_USER_ID)).toHaveLength(1);

  // And it resolves rather than staying locked: released, it hydrates once,
  // for the account that is actually signed in.
  await workspace.release();
  await page.waitForTimeout(4000);
  expect(relationalReads).toHaveLength(1);
  expect(relationalReads[0]).toContain(SECOND_WORKSPACE_ID);
});

test('a token refresh during hydration does not restart or abandon it', async ({ page }) => {
  const workspace = await holdWorkspaceApi(page, { holding: false });
  const snapshot = await holdSnapshotApi(page);
  await stubGoTrueUser(page);

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  // Hydration is genuinely in flight: its remote read is outstanding.
  await expect.poll(() => snapshot.count, { timeout: 30_000 }).toBe(1);

  /*
   * A real auth-js refresh for the SAME account, mid-hydration -- an ordinary
   * event, since auth-js renews on visibility. It flips `workspaceReady` false
   * and back, which tears the hydration effect down and returns the identical
   * hydration key.
   *
   * Neither outcome that churn used to produce is acceptable. Tying the run to
   * the effect's lifecycle killed it, and the returning key read as "already
   * hydrated", so nothing restarted and the autosave lock was never released.
   * Clearing the key on teardown instead restarted it, hydrating the same
   * account and workspace twice. Owning the run rather than the effect does
   * neither: the run in flight simply carries on.
   */
  const sessionId = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const stored = JSON.parse(window.localStorage.getItem(key ?? '') ?? '{}') as { access_token?: string };
    const payload = (stored.access_token ?? '').split('.')[1] ?? '';
    return payload ? ((JSON.parse(atob(payload)) as { session_id?: string }).session_id ?? '') : '';
  });
  expect(sessionId).not.toBe('');
  await refreshStoredSession(page, sessionId);

  await snapshot.release();
  await page.waitForTimeout(4000);

  // One read, and no second one: not restarted, and the refresh really did
  // happen underneath it.
  expect(snapshot.count).toBe(1);
  expect(workspace.owners.filter((owner) => owner === USER_ID).length).toBeGreaterThan(1);

  // And the screen the refresh interrupted still works.
  await fillNewPassword(page, 'a-brand-new-password');
  await submit(page).click();
  await expect(page.getByText('Password updated. You are signed in.').first()).toBeVisible({ timeout: 30_000 });
  await workspace.release();
});

test('a session arriving while an obsolete one hangs resolves without waiting for it', async ({ page, context }) => {
  /*
   * Only the FIRST account's workspace requests hang. The second account's are
   * answered normally, so this measures whether the new session is allowed to
   * proceed -- not whether the route happens to be open.
   *
   * An event arriving before the bootstrap finished used to be held until it
   * did. The bootstrap is waiting on a workspace request for an account that
   * has already been replaced, and that request can hang, so the new account's
   * profile was not even REQUESTED until an obsolete one settled -- which is
   * to say never. The identity was published, so the reset screen was right;
   * the application stayed gated on 'loading' for a session that would have
   * resolved at once.
   */
  const workspace = await holdWorkspaceApi(page, { only: USER_ID });
  const relationalReads: string[] = [];
  await page.route(HORSES_REST, async (route) => {
    relationalReads.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await stubGoTrueUser(page);

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => workspace.owners, { timeout: 30_000 }).toContain(USER_ID);
  expect(relationalReads).toEqual([]);

  const second = await context.newPage();
  await stubGoTrueUser(second, undefined, SECOND);
  await second.route(WORKSPACE_REST, fulfilWorkspace);
  await second.goto(sessionLink('signin', SECOND));
  await expect(refusal(second)).toBeVisible({ timeout: 30_000 });

  /*
   * The second account resolves and the app hydrates for it WHILE the first
   * account's request is still outstanding. Nothing is released first: that is
   * the whole assertion.
   */
  await expect.poll(() => relationalReads.length, { timeout: 30_000 }).toBe(1);
  expect(relationalReads[0]).toContain(SECOND_WORKSPACE_ID);
  expect(workspace.count).toBeGreaterThan(0);

  await workspace.release();
});

import { expect, test, type Page, type Route } from '@playwright/test';
import { blockWebfonts, recoveryLink, RECOVERY_KEY, stubGoTrueUser, USER_ID } from '../auth-smoke/support.js';

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
const WORKSPACE_ID = '7f1d0c44-0000-4000-8000-0000000000aa';

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
async function holdWorkspaceApi(page: Page) {
  const held: Route[] = [];
  let releasing = false;
  await page.route(WORKSPACE_REST, async (route) => {
    if (releasing) {
      await fulfilWorkspace(route);
      return;
    }
    held.push(route);
  });
  return {
    get count() {
      return held.length;
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
  // two are list reads.
  const body = url.includes('/workspaces?') ? JSON.stringify({ id: WORKSPACE_ID }) : '[]';
  await route.fulfill({ status: 200, contentType: 'application/json', body });
}

const heldGrant = (page: Page) => page.evaluate((key) => window.sessionStorage.getItem(key) ?? '', RECOVERY_KEY);

test('a validated recovery reaches the form while the workspace API hangs', async ({ page }) => {
  const workspace = await holdWorkspaceApi(page);
  await stubGoTrueUser(page);

  await page.goto(recoveryLink());
  await expect(newPassword(page)).toBeVisible({ timeout: 30_000 });

  // The hang is real: the store asked, and is still waiting.
  expect(workspace.count).toBeGreaterThan(0);

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

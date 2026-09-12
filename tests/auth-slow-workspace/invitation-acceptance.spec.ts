import { expect, test } from '@playwright/test';
import {
  blockWebfonts,
  readStoredAccessToken,
  RECOVERY_EMAIL,
  sessionLink,
  stubGoTrueUser,
  USER_ID,
} from '../auth-smoke/support.js';

blockWebfonts();

test('delayed cloud setup restores the requested Settings destination', async ({ page }) => {
  let releaseProfile!: () => void;
  const profileReady = new Promise<void>((resolve) => {
    releaseProfile = resolve;
  });
  let profileRequests = 0;
  await stubGoTrueUser(page);
  await page.route('**/rest/v1/**', async (route) => {
    const table = new URL(route.request().url()).pathname.split('/').pop();
    if (table === 'workspace_profiles') {
      profileRequests += 1;
      await profileReady;
      await route.fulfill({
        status: 200,
        json: {
          payload: { setupCompleteAt: '2026-09-10T12:00:00Z', ranchName: 'Delayed ranch', businessName: 'Fixture' },
          updated_at: '2026-09-10T12:00:00Z',
        },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json:
        table === 'workspaces'
          ? { id: '7f1d0c44-0000-4000-8000-0000000000dd' }
          : table === 'workspace_subscription_profiles'
            ? { payload: {} }
            : [],
    });
  });
  await page.goto(sessionLink('signin'));
  await expect(page.getByText(/This page needs a current password-reset link/)).toBeVisible();
  await expect.poll(() => readStoredAccessToken(page)).not.toBe('');
  await expect.poll(() => profileRequests).toBeGreaterThan(0);
  await page.evaluate(() => {
    // Exercise a setup entry that already carries a saved destination. The
    // cold-deep-link suite separately verifies the guard waits for the cloud.
    window.history.pushState({ usr: { from: '/settings?section=workspace' } }, '', '/app/setup');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/app\/setup$/);
  releaseProfile();
  await expect(page).toHaveURL(/\/app\/settings\?section=workspace$/);
  await expect(page.getByRole('button', { name: 'Pull cloud', exact: true })).toBeVisible();
});

test('workspace bootstrap accepts an invitation through the server RPC without client membership writes', async ({
  page,
}) => {
  const workspaceId = '7f1d0c44-0000-4000-8000-0000000000cc';
  const calls: unknown[] = [];
  const directWrites: string[] = [];
  await stubGoTrueUser(page);
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/rpc/xbar_accept_workspace_invitation')) {
      calls.push(request.postDataJSON());
      await route.fulfill({ status: 200, json: { workspaceId, role: 'Owner' } });
      return;
    }
    if (/\/workspace_(memberships|invitations)$/.test(url.pathname) && request.method() !== 'GET') {
      directWrites.push(request.method() + ' ' + url.pathname);
    }
    const pendingInvite =
      url.pathname.endsWith('/workspace_invitations') && url.searchParams.get('status') === 'eq.pending';
    await route.fulfill({
      status: 200,
      json: pendingInvite
        ? [
            {
              workspace_id: workspaceId,
              invitation_id: 'server-assigned-role',
              email: RECOVERY_EMAIL,
              role: 'Owner',
              payload: {},
            },
          ]
        : [],
    });
  });
  await page.goto(sessionLink('signin'));
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call).toEqual({ p_workspace_id: workspaceId, p_invitation_id: 'server-assigned-role' });
  }
  expect(directWrites).toEqual([]);
});

test('pushing a workspace preserves another member account binding', async ({ page }) => {
  const workspaceId = '7f1d0c44-0000-4000-8000-0000000000dd';
  const memberEmail = 'joined-member@example.invalid';
  const membershipWrites: Array<Record<string, unknown>> = [];
  const members = [
    { email: RECOVERY_EMAIL, user_id: USER_ID, role: 'Admin' },
    { email: memberEmail, user_id: '7f1d0c44-0000-4000-8000-0000000000ee', role: 'Owner' },
  ].map((member) => ({
    ...member,
    status: 'active',
    updated_at: '2026-09-10T12:00:00Z',
    payload: {
      id: `member-${member.email}`,
      email: member.email,
      role: member.role,
      status: 'Active',
      joinedAt: '2026-09-10T12:00:00Z',
      source: 'Invite',
    },
  }));
  await stubGoTrueUser(page);
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const table = new URL(request.url()).pathname.split('/').pop();
    if (table === 'workspaces') {
      await route.fulfill({ status: 200, json: { id: workspaceId } });
      return;
    }
    if (table === 'workspace_memberships') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        membershipWrites.push(...(Array.isArray(body) ? body : [body]));
      }
      await route.fulfill({ status: 200, json: members });
      return;
    }
    const single = table === 'workspace_profiles' || table === 'workspace_subscription_profiles';
    await route.fulfill({
      status: 200,
      json: single
        ? {
            payload:
              table === 'workspace_profiles'
                ? {
                    setupCompleteAt: '2026-09-10T12:00:00Z',
                    ranchName: 'Member binding fixture',
                    businessName: 'Fixture',
                  }
                : {},
            updated_at: '2026-09-10T12:00:00Z',
          }
        : [],
    });
  });
  await page.goto(sessionLink('signin'));
  await expect(page.getByText(/This page needs a current password-reset link/)).toBeVisible();
  /*
   * Wait for the session to be PERSISTED, not merely for the screen to render.
   * The refusal above means the recovery grant is absent, which says nothing
   * about whether auth-js has finished writing the session it just took from
   * the URL. Navigating on the screen alone raced that write: the next load
   * found no stored session, so `cloudSession` was null and the whole cloud
   * block -- Pull cloud included -- never rendered. Measured at 3 failures in 5
   * before this wait.
   */
  await expect.poll(() => readStoredAccessToken(page), { timeout: 15_000 }).not.toBe('');
  await page.goto('/app/settings');
  await expect(page.getByRole('button', { name: 'Pull cloud', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Pull cloud', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Push cloud', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Push cloud', exact: true }).click();
  await expect.poll(() => membershipWrites.some((row) => row.email === memberEmail)).toBe(true);
  const savedMember = membershipWrites.find((row) => row.email === memberEmail)!;
  expect(savedMember).not.toHaveProperty('user_id');
});

import { expect, test } from '@playwright/test';
import { blockWebfonts, RECOVERY_EMAIL, sessionLink, stubGoTrueUser } from '../auth-smoke/support.js';

blockWebfonts();

test('pushing an old ranch snapshot cannot recreate a removed member or reopen an invitation', async ({ page }) => {
  const workspaceId = '7f1d0c44-0000-4000-8000-0000000000dd';
  const accessWrites: unknown[] = [];
  let profileWrites = 0;
  await stubGoTrueUser(page);
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const table = new URL(request.url()).pathname.split('/').pop();
    if (request.method() !== 'GET') {
      const data = request.postDataJSON();
      if (table === 'workspace_invitations') accessWrites.push(data);
      if (table === 'workspace_memberships') {
        for (const row of Array.isArray(data) ? data : [data]) {
          // Owner bootstrap is still allowed; a stale invited member is not.
          if (row.email !== RECOVERY_EMAIL) accessWrites.push(row);
        }
      }
      if (table === 'workspace_profiles') profileWrites += 1;
      await route.fulfill({ status: 200, json: table === 'workspaces' ? { id: workspaceId } : [] });
      return;
    }
    const payload =
      table === 'workspaces'
        ? { id: workspaceId }
        : table === 'workspace_profiles'
          ? {
              payload: { setupCompleteAt: '2026-09-10T12:00:00Z', ranchName: 'Stale ranch', businessName: 'Fixture' },
              updated_at: '2026-09-10T12:00:00Z',
            }
          : table === 'workspace_subscription_profiles'
            ? { payload: {} }
            : table === 'workspace_memberships'
              ? [
                  {
                    payload: {
                      id: 'removed-member',
                      email: 'removed@xbar.test',
                      role: 'Owner',
                      status: 'Active',
                      source: 'Invite',
                      joinedAt: '2026-09-10T12:00:00Z',
                    },
                  },
                ]
              : table === 'workspace_invitations'
                ? [
                    {
                      payload: {
                        id: 'revoked-elsewhere',
                        email: 'revoked@xbar.test',
                        role: 'Owner',
                        status: 'Pending',
                        invitedAt: '2026-09-10T12:00:00Z',
                      },
                    },
                  ]
                : [];
    await route.fulfill({ status: 200, json: payload });
  });
  await page.goto(sessionLink('signin'));
  await expect(page.getByText(/This page needs a current password-reset link/)).toBeVisible();
  await page.evaluate(() => {
    window.history.pushState({}, '', '/app/settings');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByText('removed@xbar.test', { exact: true })).toBeVisible();
  await expect(page.getByText('revoked@xbar.test', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Push cloud', exact: true }).click();
  await expect(page.getByText('Cloud sync complete', { exact: true })).toBeVisible();
  expect(profileWrites).toBeGreaterThan(0);
  expect(accessWrites).toEqual([]);
});

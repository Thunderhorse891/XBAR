import { expect, test } from '@playwright/test';
import { blockWebfonts, RECOVERY_EMAIL, sessionLink, stubGoTrueUser } from '../auth-smoke/support.js';

blockWebfonts();

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

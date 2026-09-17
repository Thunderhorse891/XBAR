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

for (const scenario of [
  'shared-save',
  'read-only',
  'owner-lookup-error',
  'member-lookup-error',
  'removed-member',
  'multiple-memberships',
] as const) {
  test(`invited ranch save: ${scenario}`, async ({ page }) => {
    const workspaceId = '7f1d0c44-0000-4000-8000-0000000000aa';
    let saving = false;
    const writes: Array<{ table: string; data: Record<string, unknown> }> = [];
    let profile = { setupCompleteAt: '2026-09-10T12:00:00Z', ranchName: 'Shared ranch', businessName: 'Fixture' };
    await stubGoTrueUser(page);
    await page.route('**/rest/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const table = url.pathname.split('/').pop()!;
      if (request.method() !== 'GET') {
        const body = request.postDataJSON();
        for (const data of Array.isArray(body) ? body : [body]) writes.push({ table, data });
        if (table === 'workspace_profiles') profile = body.payload;
        await route.fulfill({ status: 200, json: table === 'workspaces' ? { id: 'incorrect-personal-ranch' } : [] });
        return;
      }
      const resolvingMember = table === 'workspace_memberships' && url.searchParams.has('user_id');
      if (
        saving &&
        ((scenario === 'owner-lookup-error' && table === 'workspaces') ||
          (scenario === 'member-lookup-error' && resolvingMember))
      ) {
        await route.fulfill({ status: 503, json: { message: 'Workspace access temporarily unavailable' } });
        return;
      }
      const role = saving && scenario === 'read-only' ? 'Owner' : 'Admin';
      const member = {
        workspace_id: workspaceId,
        user_id: USER_ID,
        email: RECOVERY_EMAIL,
        role,
        status: 'active',
        payload: {
          id: 'invited-admin',
          email: RECOVERY_EMAIL,
          role,
          status: 'Active',
          source: 'Invite',
          joinedAt: '2026-09-10T12:00:00Z',
        },
      };
      const json =
        table === 'workspaces'
          ? null
          : resolvingMember
            ? url.searchParams.get('limit') === '2'
              ? saving && scenario === 'removed-member'
                ? []
                : saving && scenario === 'multiple-memberships'
                  ? [member, { ...member, workspace_id: 'another-ranch' }]
                  : [member]
              : member
            : table === 'workspace_memberships'
              ? [member]
              : table === 'workspace_invitations' && url.searchParams.has('status')
                ? null
                : table === 'workspace_profiles'
                  ? { payload: profile, updated_at: '2026-09-10T12:00:00Z' }
                  : table === 'workspace_subscription_profiles'
                    ? { payload: {} }
                    : [];
      await route.fulfill({ status: 200, json });
    });
    await page.goto(sessionLink('signin'));
    await expect.poll(() => readStoredAccessToken(page), { timeout: 15_000 }).not.toBe('');
    await page.goto('/app/settings');
    await expect(page.getByRole('button', { name: 'Pull cloud', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pull cloud', exact: true }).click();
    await expect(page.getByText('Cloud workspace loaded', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Ranch name', { exact: true })).toHaveValue('Shared ranch');
    if (scenario === 'shared-save') {
      await page.getByLabel('Ranch name', { exact: true }).fill('Shared ranch updated');
      await page.getByRole('button', { name: 'Save profile', exact: true }).click();
      await expect(page.getByText('Profile saved', { exact: true })).toBeVisible();
    }
    writes.length = 0;
    saving = true;
    await page.getByRole('button', { name: 'Push cloud', exact: true }).click();
    if (scenario !== 'shared-save') {
      await expect(page.getByText('Cloud sync failed', { exact: true })).toBeVisible();
      expect(writes).toEqual([]);
      return;
    }
    await expect(page.getByText('Cloud sync complete', { exact: true })).toBeVisible();
    expect(writes.some(({ table }) => table === 'workspaces' || table === 'workspace_memberships')).toBe(false);
    const profileWrites = writes.filter(({ table }) => table === 'workspace_profiles');
    expect(profileWrites.length).toBeGreaterThan(0);
    for (const { data } of profileWrites) expect(data.workspace_id).toBe(workspaceId);
    expect(profile.ranchName).toBe('Shared ranch updated');
    await page.reload();
    await page.getByRole('button', { name: 'Pull cloud', exact: true }).click();
    await expect(page.getByText('Cloud workspace loaded', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Ranch name', { exact: true })).toHaveValue('Shared ranch updated');
  });
}

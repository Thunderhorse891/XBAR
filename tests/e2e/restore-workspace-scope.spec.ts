import { expect, test, type Page } from '@playwright/test';

test('an invalid backup releases the control and a subsequent valid restore still works', async ({ page }) => {
  await openSettings(page);
  const input = page.locator('input[type="file"][accept="application/json,.json"]');
  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByText('Import failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import backup', exact: true })).toBeEnabled();
  const backup = await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    const backup = useXbarStore.getState().exportWorkspaceBackup();
    backup.workspace.workspaceProfile.ranchName = 'Restored Ranch';
    return JSON.stringify(backup);
  });
  await input.setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Import backup', exact: true })).toBeEnabled();
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = '/src/store/useXbarStore.ts';
        const { useXbarStore } = await import(/* @vite-ignore */ path);
        return useXbarStore.getState().workspaceProfile.ranchName;
      }),
    )
    .toBe('Restored Ranch');
});

test('a late cloud pull cannot replace a different workspace or mark it synced', async ({ page }) => {
  await openSettings(page);
  await page.evaluate(async () => {
    const configPath = '/src/lib/platformConfig.ts';
    const clientPath = '/src/lib/supabaseClient.ts';
    const cloudPath = '/src/store/useCloudStore.ts';
    const storePath = '/src/store/useXbarStore.ts';
    const { supabaseConfig } = await import(/* @vite-ignore */ configPath);
    const { getSupabaseClient } = await import(/* @vite-ignore */ clientPath);
    const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
    const { useXbarStore } = await import(/* @vite-ignore */ storePath);
    supabaseConfig.url = window.location.origin;
    supabaseConfig.anonKey = 'synthetic-key';
    supabaseConfig.relationalSyncEnabled = false;
    supabaseConfig.snapshotFallbackEnabled = true;
    const session = { access_token: 'synthetic-token', user: { id: 'account-a' } };
    const backup = useXbarStore.getState().exportWorkspaceBackup();
    backup.workspace.workspaceProfile.ranchName = 'Cloud Ranch A';
    const client = getSupabaseClient();
    client.auth.getSession = async () => ({ data: { session }, error: null });
    const bridge = window as typeof window & { releasePull?: () => void };
    client.from = (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          if (table === supabaseConfig.workspaceTable) {
            return new Promise((resolve) => {
              bridge.releasePull = () =>
                resolve({ data: { payload: backup, updated_at: '2026-10-03T12:00:00Z' }, error: null });
            });
          }
          return Promise.resolve({ data: table === 'workspaces' ? { id: 'workspace-a' } : null, error: null });
        },
      };
      return chain;
    };
    useCloudStore.setState({ workspaceId: 'workspace-a', session, lastSyncAt: '' });
  });
  await page.getByRole('button', { name: 'Pull cloud', exact: true }).click();
  await page.waitForFunction(() => Boolean((window as typeof window & { releasePull?: () => void }).releasePull));
  await page.evaluate(async () => {
    const cloudPath = '/src/store/useCloudStore.ts';
    const storePath = '/src/store/useXbarStore.ts';
    const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
    const { useXbarStore } = await import(/* @vite-ignore */ storePath);
    useCloudStore.setState({ workspaceId: 'workspace-b', lastSyncAt: '' });
    useXbarStore.setState({
      workspaceProfile: { ...useXbarStore.getState().workspaceProfile, ranchName: 'Current Ranch B' },
    });
    (window as typeof window & { releasePull?: () => void }).releasePull?.();
  });
  await expect(page.getByRole('button', { name: 'Pull cloud', exact: true })).toBeEnabled();
  const state = await page.evaluate(async () => {
    const cloudPath = '/src/store/useCloudStore.ts';
    const storePath = '/src/store/useXbarStore.ts';
    const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
    const { useXbarStore } = await import(/* @vite-ignore */ storePath);
    return { name: useXbarStore.getState().workspaceProfile.ranchName, syncedAt: useCloudStore.getState().lastSyncAt };
  });
  expect(state).toEqual({ name: 'Current Ranch B', syncedAt: '' });
  await expect(page.getByText('Restore stopped', { exact: true })).toBeVisible();
});

async function openSettings(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Billing Test');
  await page.getByPlaceholder('Primary Ranch').fill('Billing Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Test Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('billing@example.test');
  await page.getByPlaceholder('Legal owner').fill('Test Owner');
  await page.getByPlaceholder('Owner entity').fill('Test Ranch');
  await page.getByPlaceholder('Barn A').fill('Barn A');
  await page.getByPlaceholder('Pasture 1').fill('North');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
}

for (const change of ['workspace', 'account', 'permission', 'round trip'] as const) {
  test(`a delayed backup read is stopped after ${change} changes`, async ({ page }) => {
    await openSettings(page);
    const backup = await page.evaluate(async () => {
      const cloudPath = '/src/store/useCloudStore.ts';
      const storePath = '/src/store/useXbarStore.ts';
      const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
      const { useXbarStore } = await import(/* @vite-ignore */ storePath);
      useCloudStore.setState({ workspaceId: 'workspace-a' });
      const backup = useXbarStore.getState().exportWorkspaceBackup();
      backup.workspace.workspaceProfile.ranchName = 'Imported Ranch A';
      const original = File.prototype.text;
      const bridge = window as typeof window & { releaseBackup?: () => void };
      File.prototype.text = function () {
        const content = original.call(this);
        return new Promise<string>((resolve) => {
          bridge.releaseBackup = () => void content.then(resolve);
        });
      };
      return JSON.stringify(backup);
    });
    const input = page.locator('input[type="file"][accept="application/json,.json"]');
    await input.setInputFiles({ name: 'ranch-a.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await page.waitForFunction(() => Boolean((window as typeof window & { releaseBackup?: () => void }).releaseBackup));
    await page.evaluate(async (change) => {
      const cloudPath = '/src/store/useCloudStore.ts';
      const storePath = '/src/store/useXbarStore.ts';
      const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
      const { useXbarStore } = await import(/* @vite-ignore */ storePath);
      if (change === 'permission') useXbarStore.setState({ currentRole: 'Owner' });
      else if (change === 'account')
        useCloudStore.setState({ session: { access_token: 'synthetic', user: { id: 'other-account' } } });
      else {
        useCloudStore.setState({ workspaceId: 'workspace-b' });
        if (change === 'round trip') useCloudStore.setState({ workspaceId: 'workspace-a' });
      }
      useXbarStore.setState({
        workspaceProfile: { ...useXbarStore.getState().workspaceProfile, ranchName: 'Current Ranch B' },
      });
      (window as typeof window & { releaseBackup?: () => void }).releaseBackup?.();
    }, change);
    await expect(input).toHaveValue('');
    const ranchName = await page.evaluate(async () => {
      const path = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(/* @vite-ignore */ path);
      return useXbarStore.getState().workspaceProfile.ranchName;
    });
    expect(ranchName).toBe('Current Ranch B');
  });
}

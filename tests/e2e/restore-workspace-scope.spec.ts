import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('backup carries a cloud-only original without changing the live record', async ({ page, browser }) => {
  await openSettings(page);
  const bytes = Buffer.from([0, 255, 9, 128, 3, 44]);
  await page.route('**/__backup-original', (route) => route.fulfill({ body: bytes, contentType: 'application/pdf' }));
  await seedCloudOriginal(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export backup', exact: true }).click(),
  ]);
  const archive = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(archive.files).toHaveLength(1);
  expect(Buffer.from(archive.files[0].data, 'base64')).toEqual(bytes);
  expect(archive.workspace.documents[0].localFileKey).toBe(archive.files[0].key);
  expect(archive.workspace.documents[0].state).toBe('Needs Review');
  expect(archive.omittedFiles).toEqual([]);
  const live = await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    return useXbarStore.getState().documents[0];
  });
  expect(live.localFileKey).toBeUndefined();
  expect(live.storagePath).toBe(archive.workspace.documents[0].storagePath);
  const restoreContext = await browser.newContext();
  const restoredPage = await restoreContext.newPage();
  await openSettings(restoredPage);
  await restoredPage.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
    name: 'portable.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(archive)),
  });
  await expect(restoredPage.getByText('Backup imported', { exact: true })).toBeVisible();
  await restoredPage.reload();
  await expect(restoredPage.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const restored = await restoredPage.evaluate(async () => {
    const storePath = '/src/store/useXbarStore.ts';
    const accessPath = '/src/lib/cloudWorkspace.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ storePath);
    const { getDocumentAccessUrl } = await import(/* @vite-ignore */ accessPath);
    const record = useXbarStore.getState().documents[0];
    const access = await getDocumentAccessUrl(record);
    if (!access.ok) throw new Error(access.message);
    try {
      return { state: record.state, bytes: [...new Uint8Array(await (await fetch(access.url)).arrayBuffer())] };
    } finally {
      access.release?.();
    }
  });
  expect(restored).toEqual({ state: 'Needs Review', bytes: [...bytes] });
  await restoreContext.close();
});

test('a failed cloud original stays visible as missing after archive restore', async ({ page, browser }) => {
  await openSettings(page);
  await page.route('**/__backup-original', (route) => route.fulfill({ status: 403, body: 'unavailable' }));
  await seedCloudOriginal(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export backup', exact: true }).click(),
  ]);
  const archive = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(archive.files).toEqual([]);
  expect(archive.omittedFiles).toHaveLength(1);
  expect(archive.omittedFiles[0].location).toBe('cloud');
  await expect(page.getByText('Backup exported — some files not included', { exact: true })).toBeVisible();
  const restoreContext = await browser.newContext();
  const restoredPage = await restoreContext.newPage();
  await openSettings(restoredPage);
  await restoredPage.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
    name: 'partial.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(archive)),
  });
  await expect(restoredPage.getByText('Backup imported — some files missing', { exact: true })).toBeVisible();
  await expect(restoredPage.getByText(/cloud or linked originals were not included in this archive/)).toBeVisible();
  await restoreContext.close();
});

for (const change of ['account', 'workspace', 'role round trip'] as const) {
  test(`cloud-original export stops after ${change} changes`, async ({ page }) => {
    await openSettings(page);
    await seedCloudOriginal(page);
    await page.evaluate(async () => {
      const path = '/src/lib/supabaseClient.ts';
      const { getSupabaseClient } = await import(/* @vite-ignore */ path);
      getSupabaseClient().storage.from = () => ({
        createSignedUrl: () =>
          new Promise((done) => {
            (window as typeof window & { releaseOriginal?: () => void }).releaseOriginal = () =>
              done({ data: { signedUrl: `${location.origin}/__backup-original` }, error: null });
          }),
      });
    });
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.getByRole('button', { name: 'Export backup', exact: true }).click();
    await page.waitForFunction(() =>
      Boolean((window as typeof window & { releaseOriginal?: () => void }).releaseOriginal),
    );
    await page.evaluate(async (change) => {
      const cloudPath = '/src/store/useCloudStore.ts';
      const storePath = '/src/store/useXbarStore.ts';
      const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
      const { useXbarStore } = await import(/* @vite-ignore */ storePath);
      if (change === 'account') useCloudStore.setState({ session: { access_token: 'other', user: { id: 'other' } } });
      else if (change === 'workspace') useCloudStore.setState({ workspaceId: '22222222-2222-4222-8222-222222222222' });
      else {
        useXbarStore.setState({ currentRole: 'Owner' });
        useXbarStore.setState({ currentRole: 'Admin' });
      }
      (window as typeof window & { releaseOriginal?: () => void }).releaseOriginal?.();
    }, change);
    await expect(page.getByText('Backup failed', { exact: true })).toBeVisible();
    await expect(page.getByText(/No backup was saved/)).toBeVisible();
    expect(downloads).toBe(0);
  });
}

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
    useCloudStore.setState({ workspaceId: 'workspace-a', workspaceRole: 'Admin', session, lastSyncAt: '' });
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

for (const change of [
  'workspace',
  'account',
  'permission',
  'round trip',
  'cloud permission',
  'cloud role round trip',
] as const) {
  test(`a delayed backup read is stopped after ${change} changes`, async ({ page }) => {
    await openSettings(page);
    const backup = await page.evaluate(async () => {
      const cloudPath = '/src/store/useCloudStore.ts';
      const storePath = '/src/store/useXbarStore.ts';
      const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
      const { useXbarStore } = await import(/* @vite-ignore */ storePath);
      useCloudStore.setState({
        workspaceId: 'workspace-a',
        workspaceRole: 'Admin',
        session: { access_token: 'synthetic', user: { id: 'account-a' } },
      });
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
      if (change === 'cloud permission' || change === 'cloud role round trip') {
        useCloudStore.setState({ workspaceRole: 'Owner' });
        if (change === 'cloud role round trip') useCloudStore.setState({ workspaceRole: 'Admin' });
      } else if (change === 'permission') useXbarStore.setState({ currentRole: 'Owner' });
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

async function seedCloudOriginal(page: Page) {
  await page.evaluate(async () => {
    const configPath = '/src/lib/platformConfig.ts';
    const clientPath = '/src/lib/supabaseClient.ts';
    const cloudPath = '/src/store/useCloudStore.ts';
    const storePath = '/src/store/useXbarStore.ts';
    const ownerPath = '/src/lib/recordsOwner.ts';
    const { supabaseConfig } = await import(/* @vite-ignore */ configPath);
    const { getSupabaseClient } = await import(/* @vite-ignore */ clientPath);
    const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
    const { useXbarStore } = await import(/* @vite-ignore */ storePath);
    const { rememberRecordsOwner } = await import(/* @vite-ignore */ ownerPath);
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const session = { access_token: 'synthetic', user: { id: 'account-a' } };
    supabaseConfig.url = window.location.origin;
    supabaseConfig.anonKey = 'synthetic-key';
    const client = getSupabaseClient();
    client.auth.getSession = async () => ({ data: { session }, error: null });
    client.storage.from = () => ({
      createSignedUrl: async () => ({
        data: { signedUrl: `${window.location.origin}/__backup-original` },
        error: null,
      }),
    });
    useCloudStore.setState({ workspaceId, workspaceRole: 'Admin', session });
    rememberRecordsOwner(workspaceId);
    useXbarStore.setState({
      documents: [
        {
          id: 'cloud-original',
          title: 'Cloud original',
          type: 'Registration',
          uploadedBy: 'Test',
          uploadedAt: '2026-11-09T12:00:00Z',
          source: 'Manual Upload',
          state: 'Needs Review',
          confidence: 0,
          duplicateRisk: 'Low',
          extractedTextPreview: '',
          summary: '',
          entities: {},
          fileName: 'original.pdf',
          storagePath: `${workspaceId}/documents/unassigned/original.pdf`,
        },
      ],
    });
  });
}

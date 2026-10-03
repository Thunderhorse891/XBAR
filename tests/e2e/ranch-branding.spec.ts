import { expect, test, type Page } from '@playwright/test';

async function openSettings(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('xbar-command-center-entry', 'true');
  });
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Cedar Creek LLC');
  await page.getByPlaceholder('Primary Ranch').fill('Cedar Creek Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Ranch Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('office@cedar.example');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}

async function logoFile(page: Page, color = '#224466') {
  const base64 = await page.evaluate((fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 40;
    const context = canvas.getContext('2d')!;
    context.fillStyle = fill;
    context.fillRect(0, 0, 80, 40);
    return canvas.toDataURL('image/png').split(',')[1];
  }, color);
  return { name: 'ranch-logo.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

async function savedProfile(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    return useXbarStore.getState().workspaceProfile;
  });
}

test('ranch branding is a draft until Save and survives reload, replacement and removal', async ({
  page,
}, testInfo) => {
  await openSettings(page);
  const upload = page.getByLabel('Ranch logo');
  await upload.setInputFiles(await logoFile(page));
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toBeVisible();
  await page.getByLabel('Contact phone').fill('+1 555 010 1234');
  await page.getByLabel('Website', { exact: true }).fill('https://cedar.example');
  expect((await savedProfile(page)).packetLogoDataUrl).toBeFalsy();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved on this device', { exact: true })).toBeVisible();
  const first = await savedProfile(page);
  expect(first).toMatchObject({ contactPhone: '+1 555 010 1234', website: 'https://cedar.example/' });
  expect(first.packetLogoDataUrl).toMatch(/^data:image\/png;base64,/);
  await page.getByRole('heading', { name: 'Profile', exact: true }).scrollIntoViewIfNeeded();
  await page
    .locator('.panel')
    .filter({ has: page.getByRole('heading', { name: 'Profile', exact: true }) })
    .screenshot({ path: testInfo.outputPath('ranch-settings.png') });
  await page.reload();
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toBeVisible();
  await expect(page.getByLabel('Contact phone')).toHaveValue('+1 555 010 1234');
  await upload.setInputFiles(await logoFile(page, '#772244'));
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect.poll(async () => (await savedProfile(page)).packetLogoDataUrl).not.toBe(first.packetLogoDataUrl);
  await page.getByRole('button', { name: 'Remove logo', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toHaveCount(0);
  expect((await savedProfile(page)).packetLogoDataUrl).toBeTruthy();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved on this device', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toHaveCount(0);
  expect((await savedProfile(page)).packetLogoDataUrl).toBe('');
});

test('invalid and oversized logos preserve the draft, retry works, and unsafe websites cannot save', async ({
  page,
}) => {
  await openSettings(page);
  const upload = page.getByLabel('Ranch logo');
  await expect(upload).not.toHaveAttribute('capture');
  const valid = await logoFile(page);
  await upload.setInputFiles(valid);
  const preview = page.getByRole('img', { name: 'Ranch logo preview' });
  await expect(preview).toBeVisible();
  const prior = await preview.getAttribute('src');
  for (const file of [
    { name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg onload="alert(1)"/>') },
    { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
    { name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(256 * 1024 + 1) },
  ]) {
    await upload.setInputFiles(file);
    await expect(page.getByRole('alert').filter({ hasText: /PNG or JPEG/ })).toBeVisible();
    await expect(preview).toHaveAttribute('src', prior!);
    expect((await savedProfile(page)).packetLogoDataUrl).toBeFalsy();
  }
  await upload.setInputFiles(valid);
  await expect(page.getByRole('alert').filter({ hasText: /PNG or JPEG/ })).toHaveCount(0);
  await page.getByLabel('Website', { exact: true }).fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Website must/ })).toBeVisible();
  expect((await savedProfile(page)).packetLogoDataUrl).toBeFalsy();
  await page.getByLabel('Website', { exact: true }).fill('cedar.example');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved on this device', { exact: true })).toBeVisible();
});

async function pauseLogoReads(page: Page) {
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    const pending: (() => void)[] = [];
    const testWindow = window as typeof window & { releaseLogoReads?: () => void };
    File.prototype.arrayBuffer = async function () {
      await new Promise<void>((resolve) => pending.push(resolve));
      return original.call(this);
    };
    testWindow.releaseLogoReads = () => {
      File.prototype.arrayBuffer = original;
      pending.splice(0).forEach((resolve) => resolve());
    };
  });
}

async function releaseLogoReads(page: Page) {
  await page.evaluate(() => (window as typeof window & { releaseLogoReads?: () => void }).releaseLogoReads?.());
}

test('cancel, newer picks, and navigation invalidate older logo reads', async ({ page }) => {
  await openSettings(page);
  const first = await logoFile(page);
  const second = await logoFile(page, '#884455');
  const upload = page.getByLabel('Ranch logo');
  await pauseLogoReads(page);
  await upload.setInputFiles(first);
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel logo upload', exact: true }).click();
  await releaseLogoReads(page);
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toHaveCount(0);
  await pauseLogoReads(page);
  await upload.setInputFiles(first);
  await upload.setInputFiles(second);
  await releaseLogoReads(page);
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toHaveAttribute(
    'src',
    `data:image/png;base64,${second.buffer.toString('base64')}`,
  );
  await pauseLogoReads(page);
  await upload.setInputFiles(first);
  await expect(page.getByRole('button', { name: 'Cancel logo upload', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Horses', exact: true }).click();
  // Horses is lazy-loaded. A click/URL change can leave Settings mounted under
  // Suspense; prove the destination committed before completing the old read.
  await expect(page).toHaveURL(/\/app\/horses$/);
  await expect(page.getByRole('heading', { name: 'Build your first sale-ready horse record.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
  await releaseLogoReads(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toHaveCount(0);
  expect((await savedProfile(page)).packetLogoDataUrl).toBeFalsy();
});

for (const switchKind of ['workspace', 'account', 'role'] as const) {
  test(`a ${switchKind} A→B→A transition discards both the draft and delayed logo`, async ({ page }) => {
    await openSettings(page);
    await page.getByLabel('Contact phone').fill('A private draft');
    const file = await logoFile(page);
    await pauseLogoReads(page);
    await page.getByLabel('Ranch logo').setInputFiles(file);
    await page.evaluate(async (kind) => {
      const cloudModule = '/src/store/useCloudStore.ts';
      const storeModule = '/src/store/useXbarStore.ts';
      const { useCloudStore } = await import(/* @vite-ignore */ cloudModule);
      const { useXbarStore } = await import(/* @vite-ignore */ storeModule);
      const cloud = useCloudStore.getState();
      if (kind === 'role') {
        const original = useXbarStore.getState().currentRole;
        useXbarStore.setState({ currentRole: 'Owner' });
        useXbarStore.setState({ currentRole: original });
      } else if (kind === 'workspace') {
        useCloudStore.setState({ workspaceId: 'workspace-b' });
        useCloudStore.setState({ workspaceId: cloud.workspaceId });
      } else {
        useCloudStore.setState({ session: { user: { id: 'account-b' } } });
        useCloudStore.setState({ session: cloud.session });
      }
    }, switchKind);
    await releaseLogoReads(page);
    await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toHaveCount(0);
    await expect(page.getByLabel('Contact phone')).toHaveValue('');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.getByText('Profile saved on this device', { exact: true })).toBeVisible();
    expect((await savedProfile(page)).packetLogoDataUrl).toBeFalsy();
    expect((await savedProfile(page)).contactPhone).not.toBe('A private draft');
  });
}

test('an actual persistence failure keeps edits visible and allows a durable retry', async ({ page }) => {
  await openSettings(page);
  await page.getByLabel('Ranch logo').setInputFiles(await logoFile(page));
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toBeVisible();
  await page.getByLabel('Contact phone').fill('555-0199');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    const setItem = Storage.prototype.setItem;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.transaction.db.name === 'xbar-workspace') throw new Error('Simulated storage quota failure');
      return put.apply(this, args);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('xbar-workspace') || key === 'xbar-live-workspace') throw new Error('Simulated quota failure');
      return setItem.call(this, key, value);
    };
    (window as typeof window & { restoreProfileStorage?: () => void }).restoreProfileStorage = () => {
      IDBObjectStore.prototype.put = put;
      Storage.prototype.setItem = setItem;
    };
  });
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /could not be saved on this device/ })).toBeVisible();
  await expect(page.getByText('Profile saved on this device', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Contact phone')).toHaveValue('555-0199');
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toBeVisible();
  await page.evaluate(() =>
    (window as typeof window & { restoreProfileStorage?: () => void }).restoreProfileStorage?.(),
  );
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved on this device', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Contact phone')).toHaveValue('555-0199');
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toBeVisible();
});

test('repeated Save is single-flight and a stale completion cannot claim the new workspace saved', async ({ page }) => {
  await openSettings(page);
  await page.getByLabel('Contact phone').fill('555-0111');
  await page.evaluate(async () => {
    const modulePath = '/src/lib/workspaceStorage.ts';
    const { workspaceStateStorage, getWorkspacePersistReceipt } = await import(/* @vite-ignore */ modulePath);
    const original = workspaceStateStorage.setItem;
    const testWindow = window as typeof window & { releaseProfileSave?: () => void; profileWriteCount?: number };
    testWindow.profileWriteCount = 0;
    workspaceStateStorage.setItem = (...args: Parameters<typeof original>) => {
      testWindow.profileWriteCount! += 1;
      const pending = original(...args);
      const receipt = getWorkspacePersistReceipt();
      if (receipt)
        receipt.completed = receipt.completed.then(async (saved: boolean) => {
          await new Promise<void>((resolve) => {
            testWindow.releaseProfileSave = resolve;
          });
          return saved;
        });
      return pending;
    };
  });
  await page.getByRole('button', { name: 'Save profile', exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'Saving profile…', exact: true })).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { profileWriteCount?: number }).profileWriteCount))
    .toBe(1);
  await page.evaluate(async () => {
    const modulePath = '/src/store/useCloudStore.ts';
    const { useCloudStore } = await import(/* @vite-ignore */ modulePath);
    useCloudStore.setState({ workspaceId: 'new-workspace' });
    (window as typeof window & { releaseProfileSave?: () => void }).releaseProfileSave?.();
  });
  await expect(page.getByText('Profile saved on this device', { exact: true })).toHaveCount(0);
});

test('legacy profiles remain usable and corrupt restored logos require explicit replacement or removal', async ({
  page,
}) => {
  await openSettings(page);
  await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    const state = useXbarStore.getState();
    const backup = state.exportWorkspaceBackup();
    state.importWorkspaceBackup(backup);
  });
  await expect(page.getByLabel('Contact phone')).toHaveValue('');
  await expect(page.getByLabel('Website', { exact: true })).toHaveValue('');
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toHaveCount(0);
  const remoteImages: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('untrusted-logo.example')) remoteImages.push(request.url());
  });
  await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    const state = useXbarStore.getState();
    const backup = state.exportWorkspaceBackup();
    backup.workspace.workspaceProfile.packetLogoDataUrl = 'https://untrusted-logo.example/logo.svg';
    state.importWorkspaceBackup(backup);
  });
  await expect(page.getByRole('alert').filter({ hasText: 'This logo is invalid.' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Choose a valid PNG or JPEG/ })).toBeVisible();
  expect(remoteImages).toEqual([]);
  await page.getByRole('button', { name: 'Remove logo', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved on this device', { exact: true })).toBeVisible();
  expect((await savedProfile(page)).packetLogoDataUrl).toBe('');
});

test('non-admins cannot change branding through either Settings or the store action', async ({ page }) => {
  await openSettings(page);
  await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    useXbarStore.getState().setCurrentRole('Owner');
  });
  await expect(page.getByLabel('Ranch logo')).toBeDisabled();
  await expect(page.getByLabel('Contact phone')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  const denied = await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    return useXbarStore.getState().updateWorkspaceProfile({ contactPhone: 'unauthorized' });
  });
  expect(denied.ok).toBe(false);
  expect((await savedProfile(page)).contactPhone).not.toBe('unauthorized');
});

test('a restored PNG with valid structure but no raster cannot save, and replacement recovers', async ({ page }) => {
  await openSettings(page);
  const invalidLogo =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAACElEQVR4nAMAAAAAAUgGidIAAAAASUVORK5CYII=';
  await page.evaluate(async (packetLogoDataUrl) => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    const state = useXbarStore.getState();
    const backup = state.exportWorkspaceBackup();
    backup.workspace.workspaceProfile.packetLogoDataUrl = packetLogoDataUrl;
    state.importWorkspaceBackup(backup);
  }, invalidLogo);
  const before = await savedProfile(page);
  await page.getByLabel('Contact phone').fill('555-0123');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /PNG|JPEG|logo|raster/i })).toBeVisible();
  await expect(page.getByText('Profile saved on this device', { exact: true })).toHaveCount(0);
  expect(await savedProfile(page)).toEqual(before);
  await expect(page.getByLabel('Contact phone')).toHaveValue('555-0123');
  await page.getByLabel('Ranch logo').setInputFiles(await logoFile(page));
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).not.toHaveAttribute('src', invalidLogo);
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved on this device', { exact: true })).toBeVisible();
  expect((await savedProfile(page)).contactPhone).toBe('555-0123');
  await page.reload();
  await expect(page.getByLabel('Contact phone')).toHaveValue('555-0123');
  await expect(page.getByRole('img', { name: 'Ranch logo preview' })).toBeVisible();
});

test('workspace changes during async raster validation stop Save before any profile mutation', async ({ page }) => {
  // Only the decoder's timing is replaced. The real Settings state transition,
  // store mutation boundary, and generation checks are exercised below.
  await page.route('**/api/_lib/packet-branding-raster.js*', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `
      export async function validatePacketLogoRaster() {
        window.rasterValidationStarted = true;
        await new Promise(resolve => { window.releaseRasterValidation = resolve; });
        return null;
      }
    `,
    });
  });
  await openSettings(page);
  const before = await savedProfile(page);
  await page.getByLabel('Contact phone').fill('old workspace draft');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { rasterValidationStarted?: boolean }).rasterValidationStarted),
    )
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Saving profile…', exact: true })).toBeDisabled();
  expect(await savedProfile(page)).toEqual(before);
  await page.evaluate(async () => {
    const modulePath = '/src/store/useCloudStore.ts';
    const { useCloudStore } = await import(/* @vite-ignore */ modulePath);
    const originalWorkspace = useCloudStore.getState().workspaceId;
    useCloudStore.setState({ workspaceId: 'during-raster-validation' });
    useCloudStore.setState({ workspaceId: originalWorkspace });
    (window as typeof window & { releaseRasterValidation?: () => void }).releaseRasterValidation?.();
  });
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Contact phone')).toHaveValue(before.contactPhone ?? '');
  await expect(page.getByText('Profile saved on this device', { exact: true })).toHaveCount(0);
  expect(await savedProfile(page)).toEqual(before);
});

test('freshly mounted Settings controls work after StrictMode effect replay and route remount', async ({ page }) => {
  await openSettings(page);
  await page.getByLabel('Contact phone').fill('555-0141');
  await expect(page.getByLabel('Contact phone')).toHaveValue('555-0141');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved on this device', { exact: true })).toBeVisible();
  expect((await savedProfile(page)).contactPhone).toBe('555-0141');

  await page.getByRole('link', { name: 'Horses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Build your first sale-ready horse record.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByLabel('Contact phone').fill('555-0142');
  await expect(page.getByLabel('Contact phone')).toHaveValue('555-0142');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved on this device', { exact: true })).toBeVisible();
  expect((await savedProfile(page)).contactPhone).toBe('555-0142');
});

test('a retained Save handler cannot apply its draft after Settings unmounts', async ({ page }) => {
  await openSettings(page);
  const before = await savedProfile(page);
  await page.getByLabel('Contact phone').fill('555-0177');
  await expect(page.getByLabel('Contact phone')).toHaveValue('555-0177');
  await page.getByRole('button', { name: 'Save profile', exact: true }).evaluate((button) => {
    // Retain the real React handler, rather than dispatching on a detached DOM
    // element (which would not reach React's delegated event listener at all).
    const propsKey = Object.keys(button).find((key) => key.startsWith('__reactProps$'));
    if (!propsKey) throw new Error('Could not find the mounted Save handler.');
    const props = (button as unknown as Record<string, { onClick?: () => void }>)[propsKey];
    if (typeof props.onClick !== 'function') throw new Error('The mounted Save handler is missing.');
    (window as typeof window & { retainedProfileSave?: () => void }).retainedProfileSave = props.onClick;
  });
  await page.getByRole('link', { name: 'Horses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as typeof window & { retainedProfileSave?: () => void }).retainedProfileSave?.());
  expect(await savedProfile(page)).toEqual(before);
  await expect(page.getByText('Profile saved', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Contact phone')).toHaveValue(before.contactPhone ?? '');
});

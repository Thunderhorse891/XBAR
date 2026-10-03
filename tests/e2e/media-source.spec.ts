import { expect, test, type Page } from '@playwright/test';

async function openHorse(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Media Test Ranch');
  await page.getByPlaceholder('Primary Ranch').fill('Media Test Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Ranch Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('media@example.test');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('Media Horse');
  await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
  await expect(page).toHaveURL(/\/horses\//);
}

test('horse photos offer library, camera and files without forcing camera on existing images', async ({ page }) => {
  await openHorse(page);
  await page.getByRole('button', { name: 'Add horse photo', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add horse photos' });
  await expect(picker).toBeVisible();
  for (const source of ['Photo library', 'Camera', 'Files']) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      picker.getByRole('button', { name: source, exact: true }).click(),
    ]);
    expect(await chooser.element().getAttribute('capture')).toBe(source === 'Camera' ? 'environment' : null);
    expect(chooser.isMultiple()).toBe(source !== 'Camera');
    await chooser.setFiles([]);
    await expect(picker).toBeVisible();
  }
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(picker).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Add horse photo', exact: true })).toBeFocused();
});

type UploadCall = { horseId: string; names: string[]; types: string[]; kind: string; makePrimary: boolean };
declare global {
  interface Window {
    mediaTestCalls: UploadCall[];
    mediaTestComplete?: () => void;
  }
}

// These tests exercise the real UI with a controlled upload boundary. Cloud
// storage persistence remains covered by its existing store/integration tests.
async function recordUploads(page: Page, mode: 'retry' | 'pending' = 'retry') {
  await page.evaluate(async (behavior) => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    window.mediaTestCalls = [];
    useXbarStore.setState({
      uploadHorseMedia: async (input: { horseId: string; files: File[]; kind: string; makePrimary: boolean }) => {
        window.mediaTestCalls.push({
          horseId: input.horseId,
          names: input.files.map((file) => file.name),
          types: input.files.map((file) => file.type),
          kind: input.kind,
          makePrimary: input.makePrimary,
        });
        if (behavior === 'pending') {
          await new Promise<void>((resolve) => {
            window.mediaTestComplete = resolve;
          });
        }
        return window.mediaTestCalls.length === 1 && behavior === 'retry'
          ? { ok: false, message: 'Test upload failed. Try the same files again.' }
          : { ok: true, message: `${input.files.length} photos added.` };
      },
    });
  }, mode);
}

const images = [
  { name: 'horse.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpeg picker test') },
  { name: 'horse.heic', mimeType: 'image/heic', buffer: Buffer.from('heic picker test') },
];

test('library multi-select retries the same files and Files preserves the upload contract', async ({ page }) => {
  await openHorse(page);
  await recordUploads(page);
  for (const source of ['Photo library', 'Photo library', 'Files']) {
    await page.getByRole('button', { name: 'Add Photo', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add horse photos' });
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      picker.getByRole('button', { name: source, exact: true }).click(),
    ]);
    await chooser.setFiles(images);
    await expect(picker).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Photo', exact: true })).toBeEnabled();
  }
  const calls = await page.evaluate(() => window.mediaTestCalls);
  expect(calls).toHaveLength(3);
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[1]).toEqual(calls[2]);
  expect(calls[0]).toMatchObject({
    names: ['horse.jpg', 'horse.heic'],
    types: ['image/jpeg', 'image/heic'],
    kind: 'Conformation',
    makePrimary: true,
  });
});

test('picker cancellation and Escape preserve the existing photo and restore focus', async ({ page }) => {
  await openHorse(page);
  await recordUploads(page);
  await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    const horses = useXbarStore.getState().horses;
    useXbarStore.setState({
      horses: horses.map((horse: { profileImage: string }) => ({
        ...horse,
        profileImage: 'https://example.test/existing-horse.jpg',
      })),
    });
  });
  const replace = page.getByRole('button', { name: 'Replace horse photo', exact: true });
  await replace.focus();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Add horse photos' });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    picker.getByRole('button', { name: 'Files', exact: true }).click(),
  ]);
  await chooser.setFiles([]);
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(replace).toBeFocused();
  expect(await page.evaluate(() => window.mediaTestCalls)).toEqual([]);
  await expect(replace.getByRole('img')).toHaveAttribute('src', 'https://example.test/existing-horse.jpg');
  await replace.click();
  await picker.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(replace).toBeFocused();
});

test('camera chooses one image and repeated clicks cannot start a second pending upload', async ({ page }) => {
  await openHorse(page);
  await recordUploads(page, 'pending');
  const add = page.getByRole('button', { name: 'Add horse photo', exact: true });
  await add.click();
  const picker = page.getByRole('dialog', { name: 'Add horse photos' });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    picker.getByRole('button', { name: 'Camera', exact: true }).click(),
  ]);
  await chooser.setFiles(images[0]);
  await expect(add).toBeDisabled();
  await expect(picker).not.toBeVisible();
  expect(await page.evaluate(() => window.mediaTestCalls.length)).toBe(1);
  await page.evaluate(() => window.mediaTestComplete?.());
  await expect(add).toBeEnabled();
  await add.click();
  await expect(picker).toBeVisible();
});

test('mobile source choices remain visible, tappable and keyboard-dismissible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHorse(page);
  await page.getByRole('button', { name: 'Add horse photo', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add horse photos' });
  const bounds = await picker.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  for (const source of ['Photo library', 'Camera', 'Files', 'Cancel']) {
    const button = picker.getByRole('button', { name: source, exact: true });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
});

declare global {
  interface Window {
    deliverLatePhoto: () => void;
  }
}

for (const returnToOriginal of [false, true]) {
  test(`a delayed native selection cannot cross horse routes${returnToOriginal ? ' even after A → B → A' : ''}`, async ({
    page,
  }) => {
    await openHorse(page);
    await recordUploads(page);
    const originalUrl = page.url();
    const secondId = await page.evaluate(async () => {
      const modulePath = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
      const horses = useXbarStore.getState().horses;
      const other = { ...horses[0], id: 'media-horse-b', name: 'Media Horse B' };
      useXbarStore.setState({ horses: [...horses, other] });
      return other.id;
    });
    await page.getByRole('button', { name: 'Add horse photo', exact: true }).click();
    const input = page.getByLabel('Photo library photos');
    await input.evaluate((element) => {
      // Exercise a delayed native callback even if the old DOM input unmounts.
      // Merely dispatching on a detached node would make this test pass without
      // testing the stale closure. React's current props expose its actual handler.
      const input = element as HTMLInputElement & Record<string, unknown>;
      const key = Object.keys(input).find((name) => name.startsWith('__reactProps$'))!;
      type InputProps = { onChange: (event: { currentTarget: { files: File[]; value: string } }) => void };
      const original = input[key] as InputProps;
      window.deliverLatePhoto = () => {
        const props = (input[key] ?? original) as InputProps;
        props.onChange({
          currentTarget: { files: [new File(['late'], 'late-horse.jpg', { type: 'image/jpeg' })], value: '' },
        });
      };
    });
    await page.evaluate((horseId) => {
      window.history.pushState({}, '', `/app/horses/${horseId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, secondId);
    await expect(page.locator('.xs-objhead__name')).toHaveText('Media Horse B');
    await expect(page.getByRole('dialog', { name: 'Add horse photos' })).not.toBeVisible();
    if (returnToOriginal) {
      await page.evaluate((url) => {
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, originalUrl);
      await expect(page.locator('.xs-objhead__name')).toHaveText('MEDIA HORSE');
    }
    await page.evaluate(() => window.deliverLatePhoto());
    expect(await page.evaluate(() => window.mediaTestCalls)).toEqual([]);
    // A fresh request after navigation still works for the current record.
    await page.getByRole('button', { name: 'Add horse photo', exact: true }).click();
    await page.getByLabel('Photo library photos').setInputFiles(images[0]);
    await expect.poll(() => page.evaluate(() => window.mediaTestCalls.length)).toBe(1);
    const call = await page.evaluate(() => window.mediaTestCalls[0]);
    expect(call.horseId).toBe(returnToOriginal ? new URL(originalUrl).pathname.split('/').at(-1) : secondId);
  });
}

for (const changedScope of ['role', 'workspace', 'reset', 'account'] as const) {
  test(`a native picker is revoked by ${changedScope} changes even when the original scope is restored immediately`, async ({
    page,
  }) => {
    await openHorse(page);
    await recordUploads(page);
    await page.getByRole('button', { name: 'Add horse photo', exact: true }).click();
    await page.getByLabel('Photo library photos').evaluate((element) => {
      const input = element as HTMLInputElement & Record<string, unknown>;
      const key = Object.keys(input).find((name) => name.startsWith('__reactProps$'))!;
      type InputProps = { onChange: (event: { currentTarget: { files: File[]; value: string } }) => void };
      const original = input[key] as InputProps;
      window.deliverLatePhoto = () => {
        ((input[key] ?? original) as InputProps).onChange({
          currentTarget: { files: [new File(['late'], 'late-horse.jpg', { type: 'image/jpeg' })], value: '' },
        });
      };
    });
    await page.evaluate(async (changed) => {
      const modulePath = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
      const state = useXbarStore.getState();
      if (changed === 'role') {
        useXbarStore.setState({ currentRole: 'Medical Lead' });
        useXbarStore.setState({ currentRole: state.currentRole });
      } else if (changed === 'workspace') {
        useXbarStore.setState({ workspaceProfile: { ...state.workspaceProfile } });
        useXbarStore.setState({ workspaceProfile: state.workspaceProfile });
      } else if (changed === 'reset') {
        state.resetWorkspace();
        useXbarStore.setState(state);
      } else {
        const cloudPath = '/src/store/useCloudStore.ts';
        const { useCloudStore } = await import(/* @vite-ignore */ cloudPath);
        const cloud = useCloudStore.getState();
        useCloudStore.setState({ session: { user: { id: 'another-account' } } });
        useCloudStore.setState({ session: cloud.session });
      }
      // Deliver before React can render the restored values: subscriptions,
      // rather than rendered equality alone, must have revoked the old ticket.
      window.deliverLatePhoto();
    }, changedScope);
    expect(await page.evaluate(() => window.mediaTestCalls)).toEqual([]);
    await expect(page.getByRole('dialog', { name: 'Add horse photos' })).not.toBeVisible();
  });
}

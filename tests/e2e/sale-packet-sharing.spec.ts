import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function packetStudio(page: Page, format: 'PDF' | 'HTML' = 'PDF') {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Packet Sharing Ranch');
  await page.getByPlaceholder('Primary Ranch').fill('Packet Sharing Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Test Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('sharing@example.test');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  const bytes = await page.evaluate(async (fileFormat) => {
    const storePath = '/src/store/useXbarStore.ts';
    const vaultPath = '/src/lib/localFileVault.ts';
    const generatorPath = '/src/lib/localSalePacketGenerator.ts';
    const storagePath = '/src/lib/workspaceStorage.ts';
    const { getWorkspacePersistReceipt } = await import(/* @vite-ignore */ storagePath);
    const { useXbarStore } = await import(/* @vite-ignore */ storePath);
    const { storeLocalFile } = await import(/* @vite-ignore */ vaultPath);
    const { buildLocalSalePacket } = await import(/* @vite-ignore */ generatorPath);
    const result = useXbarStore.getState().addHorse({
      name: 'Bella Sharing',
      segment: 'Sale Prospect',
      barnName: 'Bella',
      owner: 'Test Owner',
      ownerEntity: 'Test Ranch',
      breed: 'Quarter Horse',
      sex: 'Mare',
      color: 'Sorrel',
      foaledOn: '2018-01-01',
      registry: 'AQHA',
      registrationNumber: 'TEST123',
      status: 'Pasture',
      barn: 'Barn A',
      pasture: 'North',
    });
    if (!result.ok) throw new Error(result.message);
    const state = useXbarStore.getState();
    const horse = state.horses[0];
    const html = buildLocalSalePacket({
      horse,
      documents: [],
      selectedDocumentIds: [],
      workspaceProfile: state.workspaceProfile,
      generatedBy: 'Admin',
    }).html;
    const body =
      fileFormat === 'HTML'
        ? new TextEncoder().encode(html)
        : new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 255, 254, 0, 128]);
    const name = fileFormat === 'HTML' ? 'Bella.html' : 'Bella.pdf';
    const type = fileFormat === 'HTML' ? 'text/html' : 'application/pdf';
    const localFileKey = await storeLocalFile(new Blob([body], { type }), name, type, 'local', { generated: true });
    useXbarStore.setState({
      salePacketBuilds: [
        {
          id: 'sharing-packet',
          horseId: horse.id,
          createdAt: '2026-10-04T12:00:00Z',
          createdBy: 'Admin',
          documentIds: ['private-paper'],
          includesBillOfSale: true,
          watermark: 'Private buyer',
          buyerName: 'Test Buyer',
          buyerEmail: 'buyer@example.test',
          status: 'generated',
          localFileKey,
          fileName: name,
        },
      ],
    });
    const receipt = getWorkspacePersistReceipt();
    if (!receipt || !(await receipt.completed)) throw new Error('Packet fixture did not persist');
    return Array.from(body);
  }, format);
  await page.evaluate(() => {
    window.history.pushState({}, '', '/app/sale-packets');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('button', { name: 'Share document…' })).toBeVisible();
  return bytes;
}

async function mockShare(page: Page, mode: 'resolve' | 'cancel' | 'reject' | 'pending' | 'unsupported') {
  await page.evaluate((kind) => {
    const state = window as typeof window & { handoffs?: number[][]; releaseHandoff?: () => void };
    state.handoffs = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => kind !== 'unsupported' });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        state.handoffs!.push(Array.from(new Uint8Array(await data.files![0].arrayBuffer())));
        if (kind === 'cancel') throw new DOMException('Cancelled', 'AbortError');
        if (kind === 'reject') throw new DOMException('Denied', 'NotAllowedError');
        if (kind === 'pending')
          await new Promise<void>((resolve) => {
            state.releaseHandoff = resolve;
          });
      },
    });
  }, mode);
}

async function review(page: Page) {
  await page.getByRole('button', { name: 'Share document…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share sale document' });
  await expect(dialog.getByText('File ready.', { exact: false })).toBeVisible();
  return dialog;
}

test('file share requires review, preserves bytes, and never marks the packet as posted', async ({ page }, info) => {
  const bytes = await packetStudio(page);
  await mockShare(page, 'resolve');
  const dialog = await review(page);
  await expect(dialog.getByRole('button', { name: 'Choose app…' })).toBeDisabled();
  await expect(dialog.getByText(/signatures, prices/)).toBeVisible();
  // This fixture selected a source record that is not embedded in its bytes.
  await expect(
    dialog.getByText(/1 source document record selected for this build; Bill of Sale requested/),
  ).toBeVisible();
  await expect(dialog.getByText(/1 included document/)).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'platform policy' })).toHaveAttribute(
    'href',
    'https://www.oversightboard.com/decision/bun-63gbjx9k/',
  );
  await dialog.getByRole('checkbox').check();
  await dialog.screenshot({ path: info.outputPath('share-packet-review.png') });
  await dialog.getByRole('button', { name: 'Choose app…' }).click();
  await expect(dialog.getByRole('status')).toContainText('cannot confirm an upload or post');
  const observed = await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    return {
      handoffs: (window as typeof window & { handoffs: number[][] }).handoffs,
      status: useXbarStore.getState().salePacketBuilds[0].status,
    };
  });
  expect(observed).toEqual({ handoffs: [bytes], status: 'generated' });
});

test('unsupported HTML sharing offers an explicit byte-exact download after reload', async ({ page }) => {
  const bytes = await packetStudio(page, 'HTML');
  await page.reload();
  await mockShare(page, 'unsupported');
  const dialog = await review(page);
  await expect(dialog.getByRole('button', { name: 'Choose app…' })).toBeDisabled();
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download for review or upload' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('Bella.html');
  expect(Array.from(await readFile((await download.path())!))).toEqual(bytes);
  await expect(dialog.getByRole('status')).toContainText('Download started');
  expect(await page.evaluate(() => (window as typeof window & { handoffs: number[][] }).handoffs.length)).toBe(0);
});

for (const mode of ['cancel', 'reject'] as const) {
  test(`${mode} reports honestly and can be retried without an automatic download`, async ({ page }) => {
    await packetStudio(page);
    await mockShare(page, mode);
    const dialog = await review(page);
    await dialog.getByRole('checkbox').check();
    let downloads = 0;
    page.on('download', () => downloads++);
    await dialog.getByRole('button', { name: 'Choose app…' }).click();
    await expect(
      dialog.getByText(mode === 'cancel' ? 'Share cancelled.' : 'The file was not handed off.', { exact: false }),
    ).toBeVisible();
    expect(downloads).toBe(0);
    await mockShare(page, 'resolve');
    await dialog.getByRole('button', { name: 'Choose app…' }).click();
    await expect(dialog.getByRole('status')).toContainText('cannot confirm an upload or post');
  });
}

test('repeated clicks are single-flight, and switching A → B → A invalidates a pending share', async ({ page }) => {
  await packetStudio(page);
  await mockShare(page, 'pending');
  const dialog = await review(page);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Choose app…' }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(dialog.getByRole('button', { name: 'Choose app…' })).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((window as typeof window & { releaseHandoff?: () => void }).releaseHandoff)),
    )
    .toBe(true);
  await page.evaluate(async () => {
    const path = '/src/store/useCloudStore.ts';
    const { useCloudStore } = await import(/* @vite-ignore */ path);
    const old = useCloudStore.getState().workspaceId;
    useCloudStore.setState({ workspaceId: 'other-ranch' });
    useCloudStore.setState({ workspaceId: old });
    (window as typeof window & { releaseHandoff?: () => void }).releaseHandoff?.();
  });
  await expect(dialog.getByRole('alert')).toContainText('changed');
  await expect(dialog.getByText('cannot confirm an upload or post', { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { handoffs: number[][] }).handoffs.length)).toBe(1);
});

for (const change of ['role', 'packet'] as const) {
  test(`${change} change invalidates a reviewed prepared file before handoff`, async ({ page }) => {
    await packetStudio(page);
    await mockShare(page, 'resolve');
    const dialog = await review(page);
    await dialog.getByRole('checkbox').check();
    await page.evaluate(async (kind) => {
      const path = '/src/store/useXbarStore.ts';
      const { useXbarStore } = await import(/* @vite-ignore */ path);
      if (kind === 'role') {
        useXbarStore.setState({ currentRole: 'Owner' });
        useXbarStore.setState({ currentRole: 'Admin' });
      } else
        useXbarStore.setState({
          salePacketBuilds: useXbarStore
            .getState()
            .salePacketBuilds.map((packet: object) => ({ ...packet, buyerName: 'Changed buyer' })),
        });
    }, change);
    await expect(dialog.getByRole('alert')).toContainText('changed');
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    expect(await page.evaluate(() => (window as typeof window & { handoffs: number[][] }).handoffs.length)).toBe(0);
  });
}

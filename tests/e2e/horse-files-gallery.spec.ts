import type { HorseRecord } from '../../src/types/xbar.js';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function openHorse(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Photo Test');
  await page.getByPlaceholder('Primary Ranch').fill('Photo Test Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Test Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('files@example.test');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('Gallery Test Horse');
  await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
  await expect(page).toHaveURL(/\/horses\//);
}
async function seedPhotos(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    const image = (label: string, color: string) =>
      `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="${color}"/><text x="40" y="160" font-size="28" fill="white">${label}</text></svg>`)}`;
    const gallery = [
      { id: 'left', label: 'Left side', kind: 'Conformation', status: 'Approved', url: image('Left side', '#64748b') },
      { id: 'right', label: 'Right side', kind: 'Sale Still', status: 'Pending', url: image('Right side', '#475569') },
    ];
    useXbarStore.setState({
      horses: useXbarStore
        .getState()
        .horses.map((horse: HorseRecord) => ({ ...horse, gallery, profileImage: gallery[0].url })),
    });
  });
}
test('gallery previews extra photos, changes primary, removes recoverably and restores across reload', async ({
  page,
}, testInfo) => {
  await openHorse(page);
  await seedPhotos(page);
  await page.getByRole('button', { name: 'View Right side', exact: true }).click();
  const lightbox = page.getByRole('dialog', { name: 'Right side', exact: true });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.getByRole('img', { name: 'Right side' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lightbox).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'View Right side', exact: true })).toBeFocused();
  const right = page.getByRole('button', { name: 'View Right side', exact: true }).locator('..');
  await right.getByRole('button', { name: 'Make primary', exact: true }).click();
  await expect(right.getByText('Primary photo', { exact: true })).toBeVisible();
  await page.reload();
  const restoredRight = page.getByRole('button', { name: 'View Right side', exact: true }).locator('..');
  await expect(restoredRight.getByText('Primary photo', { exact: true })).toBeVisible();
  await restoredRight.getByRole('button', { name: 'Remove photo', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Right side', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByText('Removed photos (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Restore photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Right side', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('ranch-horse-gallery.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('horse Documents shows linked files without extracted facts and downloads their actual bytes', async ({
  page,
}, testInfo) => {
  await openHorse(page);
  await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const vault = '/src/lib/localFileVault.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ path);
    const { storeLocalFile } = await import(/* @vite-ignore */ vault);
    const localFileKey = await storeLocalFile(
      new Blob(['Original horse record bytes'], { type: 'text/plain' }),
      'horse-original.txt',
      undefined,
      'local',
    );
    const horse = useXbarStore.getState().horses[0];
    const doc = {
      id: 'original',
      title: 'Horse original',
      type: 'Other',
      horseId: horse.id,
      uploadedBy: 'Test',
      uploadedAt: '2026-10-01T12:00:00Z',
      source: 'Manual Upload',
      state: 'Needs Review',
      confidence: 0,
      duplicateRisk: 'Low',
      extractedTextPreview: '',
      summary: '',
      entities: {},
      localFileKey,
      fileName: 'horse-original.txt',
    };
    useXbarStore.setState({ documents: [doc], horses: [{ ...horse, documentFacts: [], documents: ['original'] }] });
  });
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const row = page.getByRole('row', { name: 'Horse original library actions' });
  await expect(row).toBeVisible();
  await expect(row.getByText('On this device', { exact: true })).toBeVisible();
  await expect(row.getByText('Needs Review', { exact: true })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: 'Download original', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('horse-original.txt');
  expect(await readFile((await download.path())!, 'utf8')).toBe('Original horse record bytes');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('ranch-horse-document-library.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: /Upload document for/i }).click();
  await expect(page).toHaveURL(/horse=.*upload=1/);
});

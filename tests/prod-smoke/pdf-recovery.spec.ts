import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

test.use({ serviceWorkers: 'block', actionTimeout: 20_000 });

async function workspace(page: Page) {
  return page.evaluate(async () => {
    const raw = await new Promise<string>((resolve, reject) => {
      const open = indexedDB.open('xbar-workspace', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('persist', 'readonly').objectStore('persist').get('xbar-live-workspace');
        request.onsuccess = () => {
          db.close();
          resolve(request.result);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      };
    });
    return JSON.parse(raw).state as {
      documents: Array<{
        fileName: string;
        processingNote?: string;
        entities: { horseName?: string; registrationNumber?: string; foaledOn?: string };
        localFileKey?: string;
        contentSha256?: string;
      }>;
      horses: Array<{ name: string; registrationNumber?: string }>;
    };
  });
}

async function upload(page: Page, name: string, buffer: Buffer, count: number) {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Upload Document', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Upload Document' });
  await drawer.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/pdf', buffer });
  await drawer.getByRole('button', { name: 'Upload for review' }).click();
  await expect(drawer).not.toBeVisible({ timeout: 90_000 });
  await expect.poll(async () => (await workspace(page)).documents.length).toBe(count);
  return (await workspace(page)).documents.find((d) => d.fileName === name)!;
}

async function originalHash(page: Page, key: string) {
  return page.evaluate(async (fileKey) => {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const open = indexedDB.open('xbar-file-vault', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('files', 'readonly').objectStore('files').get(fileKey);
        request.onsuccess = () => {
          db.close();
          resolve(request.result?.blob);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      };
    });
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  }, key);
}

for (const failure of ['library', 'worker'] as const) {
  test(`PDF ${failure} startup recovers on the next upload without reloading`, async ({ page, context }) => {
    test.setTimeout(180_000);
    // The production build is necessary: a failed ES module URL is cached by
    // Chromium independently of the app's promise. A mocked import misses it.
    const path = failure === 'library' ? /\/assets\/pdf-[^/]+\.(?:mjs|js)$/ : /\/assets\/pdf\.worker\.min-/;
    let offline = true;
    let refused = 0;
    await context.route('**/assets/*', (route) => {
      if (offline && path.test(new URL(route.request().url()).pathname)) {
        refused += 1;
        return route.abort('failed');
      }
      return route.continue();
    });
    await page.goto('/app/login');
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await page.getByLabel('Business name').fill('OCR Recovery Test');
    await page.getByLabel('Ranch name').fill('Recovery Ranch');
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const sheet = pdf.addPage([600, 400]);
    const lines = [
      'CERTIFICATE OF REGISTRATION',
      'Registered Name: RECOVERY EVIDENCE',
      'Registration Number: 1234567',
      'Date Foaled: 04/12/2019',
      'Sex: Mare Color: Bay',
    ];
    lines.forEach((line, i) => sheet.drawText(line, { x: 35, y: 350 - i * 50, font, size: 16 }));
    const failed = await upload(page, 'interrupted.pdf', Buffer.from(await pdf.save()), 1);
    expect(refused, 'the real built module request must actually fail').toBeGreaterThan(0);
    expect(failed.processingNote).toContain('could not be read');
    expect(failed.entities).toEqual({});
    expect(failed.localFileKey, 'an unread file must still be preserved').toBeTruthy();
    expect(await originalHash(page, failed.localFileKey!)).toBe(failed.contentSha256);
    expect((await workspace(page)).horses).toHaveLength(0);

    offline = false;
    pdf.setTitle('Second upload after service returns');
    const recovered = await upload(page, 'recovered.pdf', Buffer.from(await pdf.save()), 2);
    expect(recovered.processingNote).not.toContain('could not be read');
    expect(recovered.entities).toMatchObject({
      horseName: 'RECOVERY EVIDENCE',
      registrationNumber: '1234567',
      foaledOn: '2019-04-12',
    });
    expect((await workspace(page)).horses).toMatchObject([{ name: 'RECOVERY EVIDENCE' }]);

    // A malformed PDF must not poison an initialized reader either.
    const malformed = await upload(page, 'malformed.pdf', Buffer.from('%PDF-1.7\ninvalid'), 3);
    expect(malformed.processingNote).toContain('could not be read');

    // Exercise rendering and actual OCR with the recovered LEGACY worker, not
    // just text-layer extraction. The image is synthetic and contains no PII.
    const pixels = await page.evaluate((text) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 800;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      ctx.font = '44px Arial';
      text.forEach((line, i) => ctx.fillText(line, 50, 100 + i * 130));
      return canvas.toDataURL('image/png').split(',')[1];
    }, lines);
    const scan = await PDFDocument.create();
    const image = await scan.embedPng(Buffer.from(pixels, 'base64'));
    scan.addPage([800, 400]).drawImage(image, { x: 0, y: 0, width: 800, height: 400 });
    const scanned = await upload(page, 'scanned.pdf', Buffer.from(await scan.save()), 4);
    expect(scanned.processingNote).not.toContain('could not be read');
    expect(scanned.entities).toMatchObject({ horseName: 'RECOVERY EVIDENCE', registrationNumber: '1234567' });
    const saved = await workspace(page);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
    expect((await workspace(page)).documents).toEqual(saved.documents);
    for (const document of saved.documents) {
      expect(await originalHash(page, document.localFileKey!)).toBe(document.contentSha256);
    }
  });
}

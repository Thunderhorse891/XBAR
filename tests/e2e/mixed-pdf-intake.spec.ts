import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// Evidence probe: a PDF whose cover page has a real text layer and whose
// SCANNED pages carry the horse identity as pixels.

async function bootstrapWorkspace(page: Page) {
  await page.addInitScript(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('xbar-command-center-entry', 'true');
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      await Promise.all(
        databases
          .map((database) => database.name)
          .filter((name): name is string => Boolean(name))
          .map(
            (name) =>
              new Promise<void>((resolve) => {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
              }),
          ),
      );
    }
  });
  await page.goto('/app/setup');
  const setupHeading = page.getByRole('heading', { name: 'Configure Workspace' });
  if (!(await setupHeading.isVisible({ timeout: 5_000 }).catch(() => false))) await page.goto('/app/setup');
  await expect(setupHeading).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('XBAR LLC').fill('XBAR Holdings');
  await page.getByPlaceholder('Primary Ranch').fill('Thunder Horse Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Erin Wyrick');
  await page.getByPlaceholder('ops@xbar.com').fill('ops@xbar.test');
  await page.getByPlaceholder('Legal owner').fill('Thunder Horse Ranch');
  await page.getByPlaceholder('Owner entity').fill('Thunder Horse Ranch LLC');
  await page.getByPlaceholder('Barn A').fill('Barn A');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });
}

/*
 * A registration that arrives as a transmittal cover sheet over scanned pages
 * -- the ordinary shape of papers sent by a registry or produced by a scanner.
 *
 * Two defects met here, and each alone loses the whole document:
 *
 *  1. The text-layer decision was made once for the WHOLE file: gather the
 *     first 8 pages' text layers, and if the TOTAL cleared 60 characters,
 *     return it and never OCR anything. The cover sheet alone clears 60, so
 *     the scanned pages were skipped.
 *  2. pdfjs-dist 6.2.108 calls `Map.prototype.getOrInsertComputed`, which
 *     Chromium 141, Node 22, Safari and Firefox do not have. `page.render()`
 *     threw for every page, so even once the OCR was attempted it rendered
 *     nothing. The legacy build ships the polyfill.
 *
 * Before either fix this upload produced `entities: {}` -- not one fact, and
 * nothing on screen to say two pages had been ignored.
 */
test('a scanned registration behind a text cover sheet is still read', async ({ page }) => {
  test.setTimeout(600_000);
  await bootstrapWorkspace(page);

  // The scanned page, as pixels.
  const scanDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 64px Arial';
    ctx.fillText('Registered Name: MIXED PDF MARE', 60, 160);
    ctx.fillText('Registration Number: 7788991', 60, 320);
    ctx.fillText('Sex: Mare  Color: Palomino', 60, 480);
    return canvas.toDataURL('image/png');
  });
  const scanBytes = Buffer.from(scanDataUrl.split(',')[1], 'base64');

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  // Page 1: a real text layer, comfortably over MIN_TEXT_LAYER_CHARS (60),
  // carrying NONE of the horse's identity -- exactly what a cover sheet or a
  // scanner's header page looks like.
  const cover = pdf.addPage([612, 792]);
  cover.drawText('AMERICAN QUARTER HORSE ASSOCIATION', { x: 40, y: 720, size: 14, font });
  cover.drawText('Document transmittal cover sheet. Please retain for', { x: 40, y: 690, size: 12, font });
  cover.drawText('your records. Pages follow this transmittal sheet.', { x: 40, y: 670, size: 12, font });
  // Pages 2 and 3: scanned images only, where the identity actually lives.
  const image = await pdf.embedPng(scanBytes);
  for (let page = 0; page < 2; page += 1) {
    const scanned = pdf.addPage([612, 792]);
    scanned.drawImage(image, { x: 20, y: 400, width: 572, height: 245 });
  }
  const pdfBytes = Buffer.from(await pdf.save());

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Upload Document' }).click();
  const drawer = page.getByRole('dialog', { name: 'Upload Document' });
  await expect(drawer).toBeVisible();
  await drawer
    .locator('input[type="file"]')
    .setInputFiles({ name: 'mixed-registration.pdf', mimeType: 'application/pdf', buffer: pdfBytes });
  await expect(drawer.getByText('1 file selected — click to change')).toBeVisible();
  // No horse selector exists in a workspace with no horses, and none is
  // needed: the measurement is what text the PDF path extracted.
  await drawer.getByRole('button', { name: 'Upload for review' }).click();
  await expect(page).toHaveURL(/\/documents|\/horses\//, { timeout: 180_000 });

  const documents = await page.evaluate(async () => {
    const raw = await new Promise<string | null>((resolve) => {
      const request = indexedDB.open('xbar-workspace', 1);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('persist')) return resolve(null);
        const read = db.transaction('persist', 'readonly').objectStore('persist').get('xbar-live-workspace');
        read.onsuccess = () => resolve(typeof read.result === 'string' ? read.result : null);
        read.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    });
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { state?: { documents?: unknown[] } };
    return (parsed.state?.documents ?? []) as Array<Record<string, unknown>>;
  });

  const [record] = documents;
  expect(record, 'the upload must have produced a document').toBeTruthy();
  const preview = String(record.extractedTextPreview ?? '').replace(/\s+/g, ' ');

  // The cover sheet is read, as it always was.
  expect(preview).toContain('transmittal cover sheet');
  // And so are the scanned pages behind it, which is the point.
  expect(preview, 'the scanned pages must be OCR read, not skipped').toContain('MIXED PDF MARE');

  const entities = (record.entities ?? {}) as Record<string, string>;
  expect(entities.horseName).toBe('MIXED PDF MARE');
  expect(entities.registrationNumber).toBe('7788991');
});

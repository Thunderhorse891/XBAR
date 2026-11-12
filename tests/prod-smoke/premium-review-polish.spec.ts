import { expect, test, type Page } from '@playwright/test';

// Disposable local-first records only. This verifies the production app bundle,
// not hosted permissions, payment or storage delivery.
async function setupHorse(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Premium Review Fixture');
  await page.getByPlaceholder('Primary Ranch').fill('Example Ranch');
  await page.getByPlaceholder('Legal owner').fill('Example Owner');
  await page.getByPlaceholder('Owner entity').fill('Example Ranch');
  await page.getByPlaceholder('Barn A').fill('Main Barn');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse', exact: true });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('Blue Dolly');
  await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
  await expect(page.locator('.xs-objhead__name')).toHaveText('BLUE DOLLY');
}
async function navigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/app${path}`);
}
async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  expect(size.page).toBeLessThanOrEqual(size.viewport);
}
async function seedReview(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('xbar-workspace', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction('persist', 'readwrite');
          const store = transaction.objectStore('persist');
          const request = store.get('xbar-live-workspace');
          request.onsuccess = () => {
            const saved = JSON.parse(request.result as string);
            const horse = saved.state.horses[0];
            horse.segment = 'Young Stock';
            horse.insuredValue = 12000;
            horse.sale.askPrice = 25000;
            saved.state.documents = [
              {
                id: 'premium-review-source',
                title: 'Blue Dolly registration',
                horseId: horse.id,
                type: 'Registration',
                state: 'Needs Review',
                uploadedBy: 'Synthetic reviewer',
                uploadedAt: new Date().toISOString(),
                source: 'Bulk Intake',
                confidence: 0.9,
                duplicateRisk: 'Low',
                summary: 'Synthetic source-review fixture',
                entities: { horseName: 'STALE PROFILE NAME', registrationNumber: '9999999' },
                extractedTextPreview:
                  'Certificate of Registration\nHorse Name: BLUE DOLLY\nRegistration Number: 1234567\nColor: Bay\n' +
                  'Long source preview '.repeat(180),
              },
            ];
            store.put(JSON.stringify(saved), 'xbar-live-workspace');
          };
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
          transaction.onabort = () => {
            db.close();
            reject(new Error('Synthetic fixture aborted'));
          };
        };
      }),
  );
  await page.reload();
}

for (const width of [1440, 390]) {
  test(`horse cards keep staged packets private and the correct insured value at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupHorse(page);
    await navigate(page, '/horses');
    await page.getByRole('button', { name: 'Stage packet', exact: true }).click();
    const card = page.locator('.horse-card');
    await expect(card.getByText('Buyer packet staged', { exact: true })).toBeVisible();
    await expect(card.getByText('Draft', { exact: true })).toBeVisible();
    await expect(page.locator('.hc-kpi').filter({ hasText: 'Buyer Packets Live' }).locator('strong')).toHaveText('0');
    await page.reload();
    await expect(card.getByText('Buyer packet staged', { exact: true })).toBeVisible();
    await seedReview(page);
    await expect(card.locator('.horse-card__metric').filter({ hasText: 'Insured' }).locator('strong')).toHaveText(
      '$12K',
    );
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`horse-card-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Hold packet', exact: true }).click();
    await expect(card.getByText('Private', { exact: true })).toBeVisible();
    await expect(card.getByText('Buyer packet staged', { exact: true })).toHaveCount(0);
  });

  test(`OCR review details are keyboard accessible, source-correct and read-only at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupHorse(page);
    await seedReview(page);
    await navigate(page, '/documents?stage=Review');
    const details = page.locator('details').filter({ hasText: 'Review extracted details' });
    await expect(details).toHaveCount(1);
    await expect(details).not.toHaveAttribute('open');
    await details.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open');
    await expect(details).toContainText('Horse name: BLUE DOLLY');
    await expect(details).toContainText('Registration number: 1234567');
    await expect(details).not.toContainText('STALE PROFILE NAME');
    await expect(details).not.toContainText('9999999');
    await expect(details.getByRole('region')).toHaveAttribute('tabindex', '0');
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`ocr-review-${width}.png`), fullPage: true });
    await details.locator('summary').press('Space');
    await expect(details).not.toHaveAttribute('open');
    await page.reload();
    await expect(details).not.toHaveAttribute('open');
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
    // The preview is observational; it must not change approved state or apply
    // the source registration to the horse merely by opening or closing it.
    await navigate(page, '/horses');
    await expect(page.locator('.horse-card__fact').filter({ hasText: 'Registry' })).toContainText('Pending');
  });
}

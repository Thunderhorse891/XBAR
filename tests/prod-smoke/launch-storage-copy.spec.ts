import { expect, test, type Page } from '@playwright/test';

// Real built production pages with synthetic local data. This does not verify
// hosted storage capacity, purchases, or provider uploads.
const SHARED_STORAGE = 'Limited cloud storage shared across XBAR at launch';
const STORAGE_DISCLOSURE =
  'Cloud storage is shared across XBAR at launch. New launch plans do not include a dedicated storage allowance; uploads depend on available capacity.';
const NUMERIC_ALLOWANCE = /[\d,]+\s*GB/i;

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'),
  );
});

async function expectNoViewportOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => innerWidth),
  );
}

async function createLocalWorkspace(page: Page) {
  await page.goto('/app/login');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByLabel('Business name').fill('Synthetic launch storage QA');
  await page.getByLabel('Ranch name').fill('Synthetic Launch Ranch');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
}

async function navigateLocally(page: Page, path: string) {
  await page.evaluate((target) => {
    history.pushState({}, '', target);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

async function savedWorkspace(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        subscription: { tier: string };
        documents: Array<{ fileName: string; localFileKey?: string }>;
      } | null>((resolve, reject) => {
        const open = indexedDB.open('xbar-workspace', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const request = database.transaction('persist').objectStore('persist').get('xbar-live-workspace');
          request.onerror = () => {
            database.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            database.close();
            resolve(request.result ? JSON.parse(request.result).state : null);
          };
        };
      }),
  );
}

for (const width of [1440, 390]) {
  test(`pricing discloses shared launch storage and preserves hero structure at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/pricing');
    const hero = page.locator('.hero.hero--solo.wrap');
    const heading = hero.getByRole('heading', {
      name: 'Simple plans. Published limits. No hidden capacity math.',
      exact: true,
    });
    await expect(heading).toBeVisible();
    await expect(hero.locator('.lead')).toContainText('Cloud storage is limited and shared across XBAR at launch.');
    const logo = page.locator('.site-header [data-xbar-signature]');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('viewBox', '0 0 1672 941');
    await expect(logo.locator('image')).toHaveAttribute('href', '/brand/xbar-original-lockup-480.png');
    await expect(logo.locator('path, text, foreignObject')).toHaveCount(0);
    expect(
      await logo.locator('image').evaluate(
        (element) =>
          new Promise<boolean>((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image.naturalWidth === 480 && image.naturalHeight === 270);
            image.onerror = () => resolve(false);
            image.src = element.getAttribute('href')!;
          }),
      ),
    ).toBe(true);

    const cards = page.locator('.plans > .plan');
    await expect(cards).toHaveCount(3);
    await expect(cards.locator('h2')).toHaveText(['Free', 'Professional', 'Ranch Ops']);
    for (const card of await cards.all()) {
      await expect(card).toContainText(SHARED_STORAGE);
      await expect(card).not.toContainText(NUMERIC_ALLOWANCE);
    }
    const comparison = page.getByRole('region', { name: 'Plan capacity comparison' });
    const storage = comparison
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: 'Storage', exact: true }) });
    await expect(storage.getByRole('cell')).toHaveText([SHARED_STORAGE, SHARED_STORAGE, SHARED_STORAGE]);
    await expect(page.getByText(STORAGE_DISCLOSURE, { exact: true })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(NUMERIC_ALLOWANCE);

    const headingBox = await heading.boundingBox();
    const leadBox = await hero.locator('.lead').boundingBox();
    const heroBox = await hero.boundingBox();
    const plansBox = await page.locator('.plans').boundingBox();
    expect(headingBox).not.toBeNull();
    expect(leadBox).not.toBeNull();
    expect(heroBox).not.toBeNull();
    expect(plansBox).not.toBeNull();
    expect(headingBox!.y + headingBox!.height).toBeLessThanOrEqual(leadBox!.y);
    expect(heroBox!.y + heroBox!.height).toBeLessThanOrEqual(plansBox!.y);
    await expectNoViewportOverflow(page);
    // Text changed for launch accuracy: this is a review capture, not a claim
    // that the old and new hero text are pixel-identical.
    await page.screenshot({ path: info.outputPath(`workspace-launch-storage-pricing-${width}.png`), fullPage: true });
  });

  test(`Documents shows used bytes without a promised allowance and keeps manual upload at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createLocalWorkspace(page);
    await navigateLocally(page, '/app/documents');
    await expect(page.getByText('Your Documents', { exact: true })).toBeVisible();
    const upload = page.locator('.panel').filter({
      has: page.getByRole('heading', { name: 'Stage 1 · Upload', exact: true }),
    });
    await expect(upload.getByText(STORAGE_DISCLOSURE, { exact: true })).toBeVisible();
    await expect(upload.locator('.panel__action')).toHaveText(/^\d+(?:\.\d+)? GB used$/);
    await expect(upload.locator('.panel__action')).not.toContainText('/');
    await expect(upload.getByRole('button', { name: 'Review only', exact: true })).toBeVisible();
    await expectNoViewportOverflow(page);
    await page.screenshot({ path: info.outputPath(`workspace-launch-storage-documents-${width}.png`), fullPage: true });

    const fileName = 'synthetic-launch-note.txt';
    const original = 'Synthetic local manual document evidence.';
    await upload.getByLabel('Uploaded by', { exact: true }).fill('Synthetic Owner');
    await upload.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(original),
    });
    await upload.getByRole('button', { name: 'Add docs', exact: true }).click();
    await expect
      .poll(async () => (await savedWorkspace(page))?.documents.find((document) => document.fileName === fileName))
      .toMatchObject({ fileName });
    const saved = await savedWorkspace(page);
    expect(saved?.subscription.tier).toBe('Free');
    const key = saved?.documents.find((document) => document.fileName === fileName)?.localFileKey;
    expect(key).toBeTruthy();
    await page.reload();
    await expect(page.getByText('Your Documents', { exact: true })).toBeVisible();
    expect((await savedWorkspace(page))?.documents.some((document) => document.fileName === fileName)).toBe(true);
    const retained = await page.evaluate(
      (fileKey) =>
        new Promise<string>((resolve, reject) => {
          const open = indexedDB.open('xbar-file-vault', 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const request = database.transaction('files').objectStore('files').get(fileKey!);
            request.onerror = () => {
              database.close();
              reject(request.error);
            };
            request.onsuccess = async () => {
              database.close();
              if (!(request.result?.blob instanceof Blob)) return reject(new Error('Manual original is missing'));
              resolve(await request.result.blob.text());
            };
          };
        }),
      key,
    );
    expect(retained).toBe(original);
    await expectNoViewportOverflow(page);
    await page.screenshot({
      path: info.outputPath(`workspace-launch-storage-retained-original-${width}.png`),
      fullPage: true,
    });
  });

  test(`billing feature cards disclose shared launch storage at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createLocalWorkspace(page);
    await navigateLocally(page, '/app/billing');
    await expect(page.getByRole('heading', { name: 'Review Billing', exact: true })).toBeVisible();
    const cards = page.locator('.checkout-plan-list .checkout-plan');
    await expect(cards).toHaveCount(2);
    await expect(cards.locator('h3')).toHaveText(['Professional', 'Ranch Ops']);
    await expect(page.getByRole('article', { name: 'Free plan', exact: true })).not.toContainText(NUMERIC_ALLOWANCE);
    for (const card of await cards.all()) {
      await expect(card.locator('.checkout-plan__features')).toContainText(SHARED_STORAGE);
      await expect(card.locator('.checkout-plan__features')).not.toContainText(NUMERIC_ALLOWANCE);
    }
    await expectNoViewportOverflow(page);
    await page.screenshot({ path: info.outputPath(`workspace-launch-storage-billing-${width}.png`), fullPage: true });
  });
}

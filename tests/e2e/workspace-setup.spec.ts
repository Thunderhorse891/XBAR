import { expect, test, type Page } from '@playwright/test';

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

  // The application router lives under /app (marketing owns the site root).
  await page.goto('/app/setup');

  const setupHeading = page.getByRole('heading', { name: 'Configure Workspace' });
  const setupVisible = await setupHeading.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!setupVisible) {
    await page.goto('/app/setup');
  }
  await expect(setupHeading).toBeVisible({ timeout: 10_000 });

  // Fill by placeholder — stable against label theming.
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
  // Fresh workspace lands on the plain-language getting-started dashboard (no seeded records).
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible({
    timeout: 15_000,
  });
}

// Seed one real horse through the global Create > Add Horse flow (persists to the store).
async function seedHorse(page: Page, name = 'Test Prospect') {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill(name);
  await drawer.getByRole('button', { name: 'Add Horse' }).click();
  await expect(page).toHaveURL(/\/horses\//, { timeout: 15_000 });
}

test('creates a workspace and lands on the getting-started dashboard', async ({ page }) => {
  await bootstrapWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible();
  await expect(page.locator('.xs-ribbon')).toBeVisible();
  await expect(page.getByText('Smart Help')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add your first horse' })).toBeVisible();
});

test('global Create opens a real create drawer with fields', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Name', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Add Horse' })).toBeVisible();
});

test('a seeded horse produces care tasks and a task drawer', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Task Horse');
  await page.getByRole('link', { name: 'Care Tasks', exact: true }).click();
  await page.locator('.xs-task').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Open linked record' })).toBeVisible();
});

test('horses roster shows an empty state until a horse is added', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Horses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Build your first sale-ready horse record.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Horse', exact: true })).toBeVisible();
});

test('sale packets opens the real packet generator once a horse exists', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Packet Horse');
  await page.getByRole('link', { name: 'Sale Packets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sale Packets' })).toBeVisible();
  await expect(page.getByText('Horse readiness')).toBeVisible();
  await page
    .locator('.xs-mrow')
    .filter({ hasText: /packet horse/i })
    .getByRole('button', { name: 'Build packet' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Sale packet generator' })).toBeVisible();
  await expect(page.getByText('is selected for release-gate review')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByText('Release gate: this packet cannot be issued until title & transfer is provable.'),
  ).toBeVisible();
});

test('buyer follow-up shows an empty state on a fresh workspace', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Buyer follow-up', exact: true }).click();
  await expect(page.getByText('No buyers yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare Sale Packet' })).toBeVisible();
});

test('documents shows an empty state on a fresh workspace', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await expect(page.getByText('Review queue is clear')).toBeVisible();
});

test('pasture location opens a detail drawer', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Pastures', exact: true }).click();
  await page.locator('.xs-grid-2 .xs-card').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Horses currently here')).toBeVisible();
});

test('a seeded horse opens a full profile object page with tabs', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Roster Prospect');
  await page.getByRole('link', { name: 'Horses', exact: true }).click();
  await page.getByRole('link', { name: 'Horse record' }).click();
  await expect(page).toHaveURL(/\/horses\//);
  await expect(page.locator('.xs-objhead__name')).toHaveText(/roster prospect/i);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByText('No documents linked to this horse yet.')).toBeVisible();
});

test('sales renders the buyer follow-up sales surface', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Sales', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sales & Transfers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Buyer follow-up' })).toBeVisible();
});

test('billing page shows tier cards', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('button', { name: 'Billing' }).click();
  await expect(page.getByRole('heading', { name: 'Review Billing' })).toBeVisible();
  await expect(page.locator('.checkout-plan')).toHaveCount(4);
});

test('OCR pipeline: an uploaded image is read on-device and matched to a horse by its pixels', async ({ page }) => {
  test.setTimeout(180_000);
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Ocr Test Horse');

  // Generate a scan-like PNG in the browser. The filename is deliberately
  // generic, and no horse is selected at upload — the ONLY way this document
  // can match "Ocr Test Horse" is if tesseract actually reads the pixels.
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 64px Arial';
    ctx.fillText('COGGINS TEST CERTIFICATE', 60, 140);
    ctx.fillText('Horse: OCR TEST HORSE', 60, 280);
    ctx.fillText('Result: NEGATIVE', 60, 420);
    return canvas.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Upload Document' }).click();
  const drawer = page.getByRole('dialog', { name: 'Upload Document' });
  await expect(drawer).toBeVisible();
  await drawer.locator('input[type="file"]').setInputFiles({ name: 'scan-001.png', mimeType: 'image/png', buffer });
  await expect(drawer.getByText('1 file selected — click to change')).toBeVisible();
  // Leave horse assignment to the pipeline: pixels must drive the match.
  await drawer.locator('select').first().selectOption('');
  // OCR (worker init + recognition) runs during submit — allow real time.
  await drawer.getByRole('button', { name: 'Upload for review' }).click();
  await expect(page).toHaveURL(/\/documents/, { timeout: 120_000 });

  // The document appears in the review queue, and its row shows the horse the
  // pipeline matched from the OCR text — proof the pixels were actually read
  // (the filename carries no horse signal and no horse was selected).
  const row = page.locator('tr', { hasText: 'scan-001' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText('Ocr Test Horse').first()).toBeVisible();
});

test('registration intake extracts sex, color, sire and dam into a new horse profile', async ({ page }) => {
  test.setTimeout(120_000);
  await bootstrapWorkspace(page);

  // A registration certificate as flat text (a .txt is read directly, so this
  // asserts the field extraction + profile threading without OCR variance —
  // the pixel-reading path is covered by the OCR pipeline test above).
  const registration = [
    'AMERICAN QUARTER HORSE ASSOCIATION CERTIFICATE OF REGISTRATION',
    'Registered Name: DOCS SMART LENA',
    'Registration Number: 5544332',
    'Sex: Mare Color: Palomino Foaled: 04/12/2021',
    'Sire: SMART CHIC OLENA AQHA 3120011',
    'Dam: DOCS SUGAR BARS AQHA 3220022',
    'Owner: BLUE RIVER RANCH LLC',
  ].join('\n');
  const buffer = Buffer.from(registration, 'utf8');

  // The global Create > Upload Document flow must work on an empty workspace —
  // it is the path that bootstraps the first horses from their papers.
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Upload Document' }).click();
  const drawer = page.getByRole('dialog', { name: 'Upload Document' });
  await expect(drawer).toBeVisible();
  await drawer
    .locator('input[type="file"]')
    .setInputFiles({ name: 'registration-docs-smart-lena.txt', mimeType: 'text/plain', buffer });
  await expect(drawer.getByText('1 file selected — click to change')).toBeVisible();
  // Creating profiles from papers is the default opt-in.
  await expect(drawer.getByRole('checkbox')).toBeChecked();
  await drawer.getByRole('button', { name: 'Upload for review' }).click();

  // Exactly one horse is created, so the app lands on its new profile page.
  await expect(page).toHaveURL(/\/horses\//, { timeout: 60_000 });
  await expect(page.locator('.xs-objhead__name')).toHaveText(/docs smart lena/i);

  // The Overview identity card carries the extracted registration facts.
  const identity = page.locator('.xs-kv');
  await expect(identity).toContainText('Palomino');
  await expect(identity).toContainText('Mare');
  await expect(identity).toContainText('SMART CHIC OLENA (3120011)');
  await expect(identity).toContainText('DOCS SUGAR BARS (3220022)');
  await expect(identity).toContainText('5544332');
});

test('panel sheen overlays stay inside their cards (no sidebar wash)', async ({ page }) => {
  await bootstrapWorkspace(page);
  // Full reloads of pages built on .panel components used to let the
  // decorative ::after gradient anchor to the viewport, washing out the
  // sidebar. The host must establish its own positioning context.
  // Client-side navigation (pushState drives React Router) — full reloads
  // race IndexedDB hydration in the dev server and land on /setup.
  await page.evaluate(() => {
    window.history.pushState({}, '', '/app/medical');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  const panel = page.locator('.panel').first();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const check = await page.evaluate(() => {
    const results: string[] = [];
    for (const sel of ['.panel', '.metric-card', '.horse-card', '.table-shell']) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (getComputedStyle(el).position === 'static') results.push(sel);
      }
    }
    return results;
  });
  expect(check, 'sheen hosts must not be position:static').toEqual([]);
});

import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

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
  // A workspace with nothing in it opens on Upload, not on an empty review
  // queue: with no documents the useful next step is adding one, and showing
  // someone a clear queue they never filled reads as a dead end. This asserted
  // the pre-d9717cc landing stage and went unnoticed because CI does not run
  // this suite.
  await expect(page.getByText('No documents yet')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Upload/ })).toHaveAttribute('aria-selected', 'true');
  // The review stage still says plainly that nothing is waiting there.
  await page.getByRole('tab', { name: /Review/ }).click();
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
  const reviewState = await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    const state = useXbarStore.getState();
    return {
      document: state.documents[0].state,
      ownership: state.ownershipRecords[0].confidence,
      facts: state.horses[0].documentFacts.length,
    };
  });
  expect(reviewState).toEqual({ document: 'Needs Review', ownership: 0, facts: 0 });

  // Correcting a wrong extraction must persist: open Edit details, fix the color.
  await page.getByRole('button', { name: 'Edit details' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Horse' });
  await expect(edit).toBeVisible();
  const colorField = edit.getByLabel('Color');
  await colorField.fill('Buckskin');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  await expect(page.locator('.xs-kv')).toContainText('Buckskin');
  await expect(page.locator('.xs-kv')).not.toContainText('Palomino');

  // A synthetic local entitlement isolates export behavior from billing. The
  // horse above still comes from the real upload -> correction workflow.
  await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    const subscription = useXbarStore.getState().subscription;
    useXbarStore.setState({
      subscription: {
        ...subscription,
        tier: 'Ranch Ops',
        purchasedTier: 'Ranch Ops',
        billingState: 'Manual Billing',
      },
    });
    history.pushState({}, '', '/app/reports');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Know what the herd is worth' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Know what the herd is worth' })).toHaveCSS(
    'color',
    'rgb(255, 250, 242)',
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const csvEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export spreadsheet', exact: true }).click();
    const csv = await csvEvent;
    expect(await csv.failure()).toBeNull();
    expect(await readFile((await csv.path())!, 'utf8')).toMatch(/DOCS SMART LENA/i);
    const pdfEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
    const pdf = await pdfEvent;
    expect(await pdf.failure()).toBeNull();
    expect((await PDFDocument.load(await readFile((await pdf.path())!))).getPageCount()).toBeGreaterThan(0);
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      actual: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll('main *')]
        .filter((el) => el.getBoundingClientRect().right > innerWidth)
        .slice(0, 12)
        .map((el) => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right })),
    }));
    expect(overflow.actual, JSON.stringify(overflow)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`reports-${width}.png`), fullPage: true });
  }
});

test('unreadable paper cannot invent a horse or approve a document', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Upload Document' }).click();
  const drawer = page.getByRole('dialog', { name: 'Upload Document' });
  await drawer.locator('input[type="file"]').setInputFiles({
    name: 'registration-unreadable.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(''),
  });
  await drawer.getByRole('button', { name: 'Upload for review' }).click();
  await expect(page).toHaveURL(/\/documents/);
  const result = await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    const state = useXbarStore.getState();
    return { horses: state.horses.length, documents: state.documents.map((d: { state: string }) => d.state) };
  });
  expect(result).toEqual({ horses: 0, documents: ['Needs Review'] });
});

test('a multi-file batch upload creates one horse per registration paper', async ({ page }) => {
  test.setTimeout(120_000);
  await bootstrapWorkspace(page);

  const paper = (name: string, reg: string, color: string) =>
    [
      'AMERICAN QUARTER HORSE ASSOCIATION CERTIFICATE OF REGISTRATION',
      `Registered Name: ${name}`,
      `Registration Number: ${reg}`,
      `Sex: Mare Color: ${color}`,
    ].join('\n');

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Upload Document' }).click();
  const drawer = page.getByRole('dialog', { name: 'Upload Document' });
  await expect(drawer).toBeVisible();
  await drawer.locator('input[type="file"]').setInputFiles([
    { name: 'reg-daisy.txt', mimeType: 'text/plain', buffer: Buffer.from(paper('DESERT DAISY', '7001111', 'Bay')) },
    { name: 'reg-belle.txt', mimeType: 'text/plain', buffer: Buffer.from(paper('CANYON BELLE', '7002222', 'Gray')) },
  ]);
  await expect(drawer.getByText('2 files selected — click to change')).toBeVisible();
  await expect(drawer.getByRole('checkbox')).toBeChecked();
  await drawer.getByRole('button', { name: 'Upload for review' }).click();
  // Batch creates multiple horses, so it returns to the documents workspace.
  await expect(page).toHaveURL(/\/documents/, { timeout: 60_000 });

  // Both papers produced their own horse record in the roster.
  await page.getByRole('link', { name: 'Horses', exact: true }).click();
  const names = await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    return useXbarStore
      .getState()
      .horses.map((horse: { name: string }) => horse.name)
      .sort();
  });
  expect(names).toEqual(['CANYON BELLE', 'DESERT DAISY']);
});

test('a Needs-Review document can spawn a new horse from the review stage', async ({ page }) => {
  test.setTimeout(120_000);
  await bootstrapWorkspace(page);

  const registration = [
    'AMERICAN QUARTER HORSE ASSOCIATION CERTIFICATE OF REGISTRATION',
    'Registered Name: RUSTIC ROYAL LADY',
    'Registration Number: 6612345',
    'Sex: Filly Color: Buckskin',
    'Sire: ROYAL BLUE BOON AQHA 3310099',
    'Dam: RUSTIC PEPPY AQHA 3410088',
  ].join('\n');
  const buffer = Buffer.from(registration, 'utf8');

  // Upload with profile-creation turned OFF, so the document lands in the
  // review queue unattached — the exact state the review-stage action targets.
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Upload Document' }).click();
  const drawer = page.getByRole('dialog', { name: 'Upload Document' });
  await expect(drawer).toBeVisible();
  await drawer
    .locator('input[type="file"]')
    .setInputFiles({ name: 'registration-rustic-royal-lady.txt', mimeType: 'text/plain', buffer });
  await expect(drawer.getByText('1 file selected — click to change')).toBeVisible();
  await drawer.getByRole('checkbox').uncheck();
  await drawer.getByRole('button', { name: 'Upload for review' }).click();
  await expect(page).toHaveURL(/\/documents/, { timeout: 60_000 });

  // The review stage is the default view; the unattached document offers a
  // "New horse" action that creates the record its paper describes.
  await page.getByRole('button', { name: 'New horse' }).click();
  await expect(page).toHaveURL(/\/horses\//, { timeout: 30_000 });
  await expect(page.locator('.xs-objhead__name')).toHaveText(/rustic royal lady/i);
  const identity = page.locator('.xs-kv');
  await expect(identity).toContainText('Buckskin');
  await expect(identity).toContainText('ROYAL BLUE BOON (3310099)');
  await expect(identity).toContainText('RUSTIC PEPPY (3410088)');
});

test('review-stage "New horse" attaches to an existing match instead of duplicating', async ({ page }) => {
  test.setTimeout(120_000);
  await bootstrapWorkspace(page);

  const registration = [
    'AMERICAN QUARTER HORSE ASSOCIATION CERTIFICATE OF REGISTRATION',
    'Registered Name: SILVER CANYON KING',
    'Registration Number: 8809900',
    'Sex: Stud Color: Gray',
  ].join('\n');

  // Upload the paper BEFORE any horse exists, so it sits in review unmatched
  // (auto-match links to a horse only at upload time).
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Upload Document' }).click();
  const drawer = page.getByRole('dialog', { name: 'Upload Document' });
  await expect(drawer).toBeVisible();
  await drawer
    .locator('input[type="file"]')
    .setInputFiles({ name: 'reg-silver-canyon-king.txt', mimeType: 'text/plain', buffer: Buffer.from(registration) });
  await expect(drawer.getByText('1 file selected — click to change')).toBeVisible();
  await drawer.getByRole('checkbox').uncheck();
  await drawer.getByRole('button', { name: 'Upload for review' }).click();
  await expect(page).toHaveURL(/\/documents/, { timeout: 60_000 });

  // Now create that horse by another route, leaving the earlier document stale
  // and still unlinked.
  await seedHorse(page, 'Silver Canyon King');

  // Back in review, "New horse" must recognise the now-existing match and
  // attach to it rather than mint a second record. (Client-side nav via
  // pushState — reliable against the profile page's layout.)
  await page.evaluate(() => {
    window.history.pushState({}, '', '/app/documents');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.getByRole('button', { name: 'New horse' }).click();
  await expect(page).toHaveURL(/\/horses\//, { timeout: 30_000 });

  // The roster still holds exactly one Silver Canyon King.
  const saved = await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    const state = useXbarStore.getState();
    return {
      horses: state.horses.length,
      document: state.documents[0].state,
      linked: state.documents[0].horseId === state.horses[0].id,
      facts: state.horses[0].documentFacts.length,
    };
  });
  expect(saved).toEqual({ horses: 1, document: 'Needs Review', linked: true, facts: 0 });
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

test('a damaged PDF in a batch reports failure without losing the readable registration', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Upload Document' }).click();
  const drawer = page.getByRole('dialog', { name: 'Upload Document' });
  await drawer.locator('input[type="file"]').setInputFiles([
    {
      name: 'damaged-registration.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\ntruncated and unreadable'),
    },
    {
      name: 'registration-batch-survivor.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'AMERICAN QUARTER HORSE ASSOCIATION CERTIFICATE OF REGISTRATION\nRegistered Name: BATCH SURVIVOR\nRegistration Number: 7003333\nSex: Mare Color: Bay',
      ),
    },
  ]);
  await drawer.getByRole('button', { name: 'Upload for review' }).click();
  await expect(page).toHaveURL(/\/documents|\/horses\//, { timeout: 30_000 });
  const result = await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    const state = useXbarStore.getState();
    return {
      horses: state.horses.map((horse: { name: string }) => horse.name),
      documents: state.documents.map((document: { title: string; processingNote?: string; state: string }) => ({
        title: document.title,
        processingNote: document.processingNote,
        state: document.state,
      })),
    };
  });
  expect(result.horses).toEqual(['BATCH SURVIVOR']);
  expect(result.documents).toHaveLength(2);
  expect(
    result.documents.some((document: { processingNote?: string }) =>
      document.processingNote?.includes('This file could not be read.'),
    ),
  ).toBe(true);
  await page
    .getByRole('link', { name: /^Documents/ })
    .first()
    .click();
  await page.getByRole('tab', { name: /Review/ }).click();
  const row = page.getByRole('group', { name: 'damaged-registration review actions' });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('match confidence');
  await expect(row).toContainText('Enter the details by hand below, or upload a clearer scan');
});

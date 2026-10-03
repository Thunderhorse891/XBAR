import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { DocumentRecord, SalesLead } from '../../src/types/xbar.js';

// Disposable local-first workspace only. No production records, email delivery,
// cloud permission changes, or notification subscriptions are exercised here.
async function setupWorkspace(page: Page) {
  await page.addInitScript(() => localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByLabel('Business name').fill('Cedar Ridge');
  await page.getByLabel('Ranch name').fill('Cedar Ridge Ranch');
  await page.getByPlaceholder('ops@yourranch.com').fill('preview@example.test');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
  await page.goto('/app/reminders');
  await expect(page.getByRole('heading', { name: 'Reminders', exact: true })).toBeVisible();
}

async function seedReminders(page: Page) {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('Copper Canyon');
  await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
  await expect(page.locator('.xs-objhead__name')).toHaveText(/copper canyon/i);
  const horseId = new URL(page.url()).pathname.split('/').at(-1)!;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const document: DocumentRecord = {
    id: 'reminders-fixture-document',
    title: 'Copper Canyon registration certificate and supporting ownership details awaiting review',
    type: 'Registration',
    horseId,
    uploadedBy: 'Example Manager',
    uploadedAt: yesterday,
    source: 'Manual Upload',
    state: 'Needs Review',
    confidence: 1,
    duplicateRisk: 'Low',
    extractedTextPreview: '',
    summary: 'Synthetic design fixture',
    entities: { horseName: 'Copper Canyon' },
  };
  const lead: SalesLead = {
    id: 'reminders-fixture-buyer',
    name: 'Example Buyer',
    channel: 'Referral',
    horseId,
    stage: 'Qualified',
    lastTouch: yesterday,
    nextFollowUp: yesterday,
    savedListing: false,
    shareReady: false,
  };
  await page.evaluate(
    ({ document, lead }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('xbar-workspace', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('persist', 'readwrite');
          const store = tx.objectStore('persist');
          const read = store.get('xbar-live-workspace');
          read.onsuccess = () => {
            if (typeof read.result !== 'string') {
              tx.abort();
              return;
            }
            const workspace = JSON.parse(read.result);
            if (workspace.state.horses.length !== 1 || workspace.state.horses[0].id !== lead.horseId) {
              tx.abort();
              return;
            }
            workspace.state.documents = [document];
            workspace.state.salesLeads = [lead];
            store.put(JSON.stringify(workspace), 'xbar-live-workspace');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.onabort = () => {
            db.close();
            reject(new Error('Synthetic reminder fixture was not saved'));
          };
        };
      }),
    { document, lead },
  );
  await page.goto('/app/reminders');
  await expect(page.locator('.reminders-item')).toHaveCount(6);
  return horseId;
}

async function capture(page: Page, info: TestInfo, name: string) {
  for (const close of await page.getByRole('button', { name: 'Close toast', exact: true }).all()) {
    if (await close.isVisible()) await close.click();
  }
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`workspace-reminders-${name}.png`), fullPage: true });
}

async function checkReadability(page: Page) {
  const samples = await page.locator('.reminders-page').evaluate((root) => {
    const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
    const blend = (foreground: number[], background: number[]) => {
      const alpha = foreground[3] ?? 1;
      return foreground.slice(0, 3).map((channel, i) => channel * alpha + background[i] * (1 - alpha));
    };
    const luminance = (color: number[]) =>
      color
        .slice(0, 3)
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        })
        .reduce((total, channel, i) => total + channel * [0.2126, 0.7152, 0.0722][i], 0);
    return Array.from(
      root.querySelectorAll(
        'h1, h2, h3, p, dt, dd, li, button, a, label > span, summary, .reminders-status, .reminders-card__label, .reminders-card strong',
      ),
    )
      .filter((element) => element.getBoundingClientRect().height > 0)
      .map((element) => {
        const ancestors: Element[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
        const background = ancestors.reduce(
          (color, node) => blend(rgb(getComputedStyle(node).backgroundColor), color),
          [255, 255, 255],
        );
        const style = getComputedStyle(element);
        const a = luminance(blend(rgb(style.color), background));
        const b = luminance(background);
        return {
          text: element.textContent,
          font: style.fontFamily,
          size: parseFloat(style.fontSize),
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
  });
  for (const sample of samples) {
    expect(sample.font, sample.text ?? '').toContain('Outfit');
    expect(sample.size, sample.text ?? '').toBeGreaterThanOrEqual(13);
    expect(sample.contrast, sample.text ?? '').toBeGreaterThanOrEqual(4.5);
  }
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.locator('.reminders-item__copy p').first()).toHaveCSS('white-space', 'normal');
  await expect(page.locator('.reminders-item__copy p').first()).toHaveCSS('font-size', '15px');
}

for (const viewport of [
  { label: 'desktop', width: 1440, height: 1000 },
  { label: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.label} reminders remain readable and preserve filters and action destinations`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setupWorkspace(page);
    await expect(page.getByRole('button', { name: 'Start first priority' })).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'No urgent work in the queue' })).toBeVisible();
    await capture(page, info, `empty-${viewport.label}`);
    const horseId = await seedReminders(page);
    await checkReadability(page);
    await expect(page.locator('.reminders-header__art')).toHaveAttribute('src', '/brand/xbar-report-horse.png');
    await expect
      .poll(() => page.locator('.reminders-header__art').evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.getByRole('link', { name: 'Email alert digest' })).toHaveAttribute(
      'href',
      /^mailto:preview%40example\.test\?subject=XBAR/,
    );
    await capture(page, info, `queue-${viewport.label}`);

    const search = page.getByRole('searchbox', { name: 'Search reminders' });
    const filter = page.getByRole('combobox', { name: 'Filter reminder type' });
    await filter.selectOption('Care');
    await expect(page.locator('.reminders-item')).toHaveCount(3);
    await search.fill('no matching horse');
    await expect(page.getByRole('heading', { name: 'No reminders match' })).toBeVisible();
    await search.fill('');
    await expect(page.locator('.reminders-item')).toHaveCount(3);
    await page.locator('.reminders-item').first().getByRole('button', { name: 'Add care event' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/(medical|health-care)\\?horse=${horseId}$`));
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Reminders', exact: true })).toBeVisible();

    for (const action of [
      { type: 'Ownership', label: 'Review transfer', route: /\/app\/(ownership|ownership-chain)$/ },
      { type: 'Documents', label: 'Review document', route: /\/app\/documents$/ },
      { type: 'Sales', label: 'Open lead', route: /\/app\/buyers\/reminders-fixture-buyer$/ },
    ]) {
      await filter.selectOption(action.type);
      await expect(page.locator('.reminders-item')).toHaveCount(1);
      await page.locator('.reminders-item').getByRole('button', { name: action.label }).click();
      await expect(page).toHaveURL(action.route);
      await page.goBack();
      await expect(page.getByRole('heading', { name: 'Reminders', exact: true })).toBeVisible();
    }

    await filter.selectOption('Documents');
    await search.fill('supporting ownership');
    await expect(page.locator('.reminders-item')).toHaveCount(1);
    await expect(page.locator('.reminders-item__copy h3')).toHaveText(/supporting ownership details awaiting review/);
    await checkReadability(page);
    await capture(page, info, `filtered-${viewport.label}`);
    await page.locator('.reminders-item').getByRole('button', { name: 'View horse' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/horses/${horseId}$`));
    await page.goBack();
    await filter.selectOption('All');
    await search.fill('');
    for (const summary of await page.locator('.reminders-disclosure > summary').all()) await summary.click();
    await expect(page.getByRole('button', { name: 'Show care', exact: true })).toBeVisible();
    await checkReadability(page);
    await capture(page, info, `details-${viewport.label}`);
    await page.getByRole('button', { name: 'Show care', exact: true }).click();
    await expect(filter).toHaveValue('Care');
    await expect(page.locator('.reminders-item')).toHaveCount(3);
    for (const summary of await page.locator('.reminders-disclosure > summary').all()) await summary.click();
    await expect(page.getByRole('button', { name: 'Show care', exact: true })).toBeHidden();
    await page.reload();
    await expect(page.locator('.reminders-item')).toHaveCount(6);
    await page.getByRole('button', { name: 'Start first priority' }).click();
    await expect(page).not.toHaveURL(/\/app\/reminders$/);
    await page.goBack();
    await page.getByRole('button', { name: 'Open health', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/(medical|health-care)$/);
    expect(errors).toEqual([]);
  });
}

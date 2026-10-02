import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { subscriptionPlans } from '../../src/lib/subscriptionPlans.js';

// Disposable, local-first records only. The synthetic Ranch Ops profile below
// exercises gated presentation; it is not evidence of a purchase or cloud sync.
async function setupRecord(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('xbar-command-center-entry', 'true');
  });
  await page.goto('/app/setup');
  await page.getByLabel('Business name').fill('Cedar Ridge');
  await page.getByLabel('Ranch name').fill('Cedar Ridge Ranch');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('Copper Canyon');
  await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
  await expect(page.locator('.xs-objhead__name')).toHaveText(/copper canyon/i);
}

async function goTo(page: Page, route: string) {
  await page.evaluate((path) => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await expect(page).toHaveURL(new RegExp(`${route}$`));
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  for (const close of await page.getByRole('button', { name: 'Close toast', exact: true }).all()) {
    if (await close.isVisible()) await close.click();
  }
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`workspace-record-${name}.png`), fullPage: true });
}

async function noPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

async function seedLocalRanchOps(page: Page) {
  await page.evaluate(
    (config) =>
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
            workspace.state.subscription = {
              ...workspace.state.subscription,
              tier: 'Ranch Ops',
              purchasedTier: 'Ranch Ops',
              billingState: 'Manual Billing',
              monthlyRate: config.monthlyRate,
              sharedAccessEnabled: config.sharedAccessEnabled,
              featureFlags: config.featureFlags,
              usage: { ...workspace.state.subscription.usage, ...config.limits },
            };
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
            reject(new Error('Local record fixture was not saved'));
          };
        };
      }),
    subscriptionPlans['Ranch Ops'],
  );
  await page.reload();
}

for (const viewport of [
  { label: 'desktop', width: 1440, height: 1000 },
  { label: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.label} horse, report and billing screens keep progressive details and actions`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setupRecord(page);
    const profileUrl = new URL(page.url()).pathname;

    await expect(page.locator('.xs-objhead__name')).toHaveCSS('color', 'rgb(245, 242, 236)');
    for (const chip of await page.locator('.xs-objhead .xs-chip').all()) {
      await expect(chip).toHaveCSS('color', 'rgb(11, 13, 15)');
      await expect(chip).toHaveCSS('background-color', 'rgb(245, 242, 236)');
      await expect(chip).toHaveCSS('font-size', '13px');
    }
    await expect(page.getByRole('button', { name: 'Edit details', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Build Sale Packet', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move', exact: true })).toBeHidden();
    await expect(page.locator('.record-disclosure').getByText('Generate proof packet', { exact: true })).toBeHidden();
    await noPageOverflow(page);
    await screenshot(page, info, `profile-${viewport.label}`);

    await page.locator('.record-more-actions > summary').click();
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Move Horse' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${profileUrl}$`));
    await page.locator('.record-more-actions > summary').click();
    await page.locator('.record-disclosure > summary').click();
    await expect(page.getByRole('button', { name: 'Generate proof packet', exact: true })).toBeDisabled();
    await page.locator('.record-disclosure > summary').click();

    for (const section of [
      'Health',
      'Documents',
      'Ownership',
      'Breeding',
      'Location',
      'Tasks',
      'Ready to Sell',
      'Buyers',
      'Timeline',
      'Overview',
    ]) {
      const tab = page.locator('.xs-tabbar').getByRole('button', { name: section, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-pressed', 'true');
      await noPageOverflow(page);
    }
    await page.reload();
    await expect(page.locator('.xs-objhead__name')).toHaveText(/copper canyon/i);

    await goTo(page, '/app/reports');
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sale readiness', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'See Ranch Ops', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Download PDF report', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export spreadsheet', exact: true })).toHaveCount(0);
    await noPageOverflow(page);
    await screenshot(page, info, `reports-locked-${viewport.label}`);

    await page.getByRole('button', { name: 'See Ranch Ops', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review Billing', exact: true })).toBeVisible();
    const plans = page.locator('.checkout-plan');
    await expect(plans).toHaveCount(4);
    for (const tier of ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'] as const) {
      const plan = plans.filter({ has: page.getByRole('heading', { name: tier, exact: true }) });
      await expect(plan.getByRole('heading', { name: tier, exact: true })).toBeVisible();
      await expect(plan.locator('.checkout-plan__features')).toBeHidden();
      await plan.locator('summary').click();
      await expect(plan.locator('.checkout-plan__features li')).toHaveCount(
        subscriptionPlans[tier].featureFlags.length,
      );
      await expect(plan.locator('.checkout-plan__features')).toBeVisible();
      await plan.locator('summary').click();
    }
    await expect(page.locator('.checkout-primary-action')).toBeDisabled();
    await expect(page.locator('.checkout-primary-action')).toHaveText('Billing not configured yet');
    await page.locator('.record-billing-details > summary').click();
    await expect(page.locator('.checkout-status-list')).toContainText('No plan change');
    await page.locator('.record-billing-details > summary').click();
    await noPageOverflow(page);
    await screenshot(page, info, `billing-${viewport.label}`);
    await page.reload();
    await expect(page.locator('.checkout-primary-action')).toBeDisabled();

    await seedLocalRanchOps(page);
    await goTo(page, '/app/reports');
    await expect(page.getByRole('button', { name: 'Export spreadsheet', exact: true })).toBeVisible();
    await expect(page.locator('.report-table')).toBeHidden();
    await page.locator('.record-disclosure > summary').click();
    await expect(page.getByRole('link', { name: /copper canyon, open profile/i })).toBeVisible();
    await noPageOverflow(page);
    await screenshot(page, info, `reports-${viewport.label}`);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export spreadsheet', exact: true }).click();
    const download = await downloadEvent;
    expect(await download.failure()).toBeNull();
    expect(await readFile((await download.path())!, 'utf8')).toMatch(/copper canyon/i);
    await page.getByRole('link', { name: /copper canyon, open profile/i }).click();
    await expect(page.locator('.xs-objhead__name')).toHaveText(/copper canyon/i);
    expect(errors).toEqual([]);
  });
}

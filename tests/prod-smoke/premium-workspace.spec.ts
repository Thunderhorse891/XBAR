import { expect, test, type Page, type TestInfo } from '@playwright/test';

// Real local-first product flows with disposable example data. These images are
// a design review of the app bundle, not evidence of production cloud sync.
async function setupWorkspace(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('xbar-command-center-entry', 'true');
  });
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Cedar Ridge');
  await page.getByPlaceholder('Primary Ranch').fill('Cedar Ridge Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Example Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('preview@example.test');
  await page.getByPlaceholder('Legal owner').fill('Cedar Ridge');
  await page.getByPlaceholder('Owner entity').fill('Cedar Ridge');
  await page.getByPlaceholder('Barn A').fill('Main Barn');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible();
}

async function addHorse(page: Page) {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('Copper Canyon');
  await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
  await expect(page.locator('.xs-objhead__name')).toHaveText(/copper canyon/i);
  await expect(page.locator('.xs-objhead__meta')).toContainText('Age not recorded');
  await expect(page.locator('.xs-objhead__meta')).not.toContainText('0 yrs');
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  for (const close of await page.getByRole('button', { name: 'Close toast', exact: true }).all()) {
    if (await close.isVisible()) await close.click();
  }
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`workspace-${name}.png`), fullPage: true });
}

async function noPageOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    viewport: window.innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  expect(size.width).toBeLessThanOrEqual(size.viewport);
}

test('desktop workspace preserves brand, horse creation and navigation', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setupWorkspace(page);
  const signature = page.locator('.xs-sidebar .xs-brand__signature');
  await expect(signature).toBeVisible();
  await expect(signature.locator('.xbar-signature__base path')).not.toHaveCount(0);
  await expect(signature.locator('image, text')).toHaveCount(0);
  await expect(signature).toHaveAttribute('width', '44');
  await expect(signature).toHaveAttribute('height', '44');
  await expect(page.locator('.xs-hero__wm')).toHaveCount(0);
  await expect(page.locator('.xs-hero__headline')).toHaveCSS('color', 'rgb(32, 36, 40)');
  await expect(page.locator('.xs-ranchcard__name')).toHaveCSS('color', 'rgb(245, 242, 236)');
  await expect(page.locator('.xs-sidebar')).toHaveCSS('background-color', 'rgb(23, 27, 32)');
  await noPageOverflow(page);
  await screenshot(page, info, 'dashboard-desktop');
  await addHorse(page);
  await screenshot(page, info, 'horse-desktop');
  await page
    .getByRole('navigation', { name: 'Primary', exact: true })
    .getByRole('link', { name: 'Horses', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Horses', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Horse record' })).toBeVisible();
  await expect(page.locator('.horse-card__kicker')).toHaveCSS('color', 'rgb(245, 242, 236)');
  await screenshot(page, info, 'horses-desktop');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Horse record' })).toBeVisible();
  await page.getByRole('link', { name: 'Horse record' }).click();
  await expect(page.locator('.xs-objhead__name')).toHaveText(/copper canyon/i);
  await expect(page.locator('.xs-objhead__meta')).toContainText('Age not recorded');
  await expect(page.locator('.xs-objhead__meta')).not.toContainText('0 yrs');
  // Seed a previously saved legacy photo reference for contrast QA. This local
  // bundle deliberately has no cloud upload service; it must not claim upload success.
  const photoUrl = 'https://fixture.xbar.test/bright.png';
  await page.route(photoUrl, (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGP4DwYMEAoAU7oL9ZisIGcAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.evaluate(
    (url) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('xbar-workspace', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('persist', 'readwrite');
          const store = transaction.objectStore('persist');
          const record = store.get('xbar-live-workspace');
          record.onsuccess = () => {
            const workspace = JSON.parse(record.result as string);
            if (workspace.state.horses.length !== 1) {
              transaction.abort();
              return;
            }
            workspace.state.horses[0].profileImage = url;
            store.put(JSON.stringify(workspace), 'xbar-live-workspace');
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
            reject(new Error('Fixture transaction aborted'));
          };
        };
      }),
    photoUrl,
  );
  await page.reload();
  await expect(page.locator('.xs-objhead__avatar-img')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Primary', exact: true })
    .getByRole('link', { name: 'Horses', exact: true })
    .click();
  await expect(page.locator('.horse-card__image')).toBeVisible();
  await expect(page.locator('.horse-card__media-bottom')).toHaveCSS('background-color', 'rgba(23, 27, 32, 0.86)');
  await screenshot(page, info, 'horses-bright-photo');
  await page.reload();
  await expect(page.locator('.horse-card__image')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Primary', exact: true })
    .getByRole('link', { name: 'Dashboard', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Your ranch at a glance.' })).toBeVisible();
  await screenshot(page, info, 'dashboard-populated-desktop');
  await noPageOverflow(page);
});

test('mobile all-sections navigation closes, restores focus, and preserves records', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setupWorkspace(page);
  await noPageOverflow(page);
  await screenshot(page, info, 'dashboard-mobile');
  const menu = page.getByRole('button', { name: 'Open navigation' });
  await menu.click();
  const navigation = page.getByRole('dialog', { name: 'Ranch navigation' });
  await expect(navigation).toBeVisible();
  await expect(navigation).toHaveCSS('background-color', 'rgb(23, 27, 32)');
  await expect(navigation.getByRole('link', { name: 'Horses', exact: true })).toHaveCSS('color', 'rgb(245, 242, 236)');
  await screenshot(page, info, 'navigation-mobile');
  await navigation.getByRole('link', { name: 'Documents', exact: true }).click();
  await expect(navigation).toBeHidden();
  await expect(page).toHaveURL(/\/app\/documents$/);
  await menu.click();
  await page.keyboard.press('Escape');
  await expect(navigation).toBeHidden();
  await expect(menu).toBeFocused();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible();
  await addHorse(page);
  await noPageOverflow(page);
  await screenshot(page, info, 'horse-mobile');
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Horses', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Horses', exact: true })).toBeVisible();
  await noPageOverflow(page);
  const segments = page.locator('.surface-tabs--wrap');
  for (const name of ['Stud', 'Show String', 'Retired', 'All']) {
    const filter = segments.getByRole('tab', { name, exact: true });
    await filter.click();
    await expect(filter).toHaveAttribute('aria-selected', 'true');
  }
  const filtersBox = await segments.boundingBox();
  const searchBox = await page.getByRole('textbox', { name: 'Search horse records' }).boundingBox();
  expect(searchBox!.y).toBeGreaterThanOrEqual(filtersBox!.y + filtersBox!.height);
  await screenshot(page, info, 'horses-mobile');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Billing' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await menu.click();
  await page
    .getByRole('dialog', { name: 'Ranch navigation' })
    .getByRole('link', { name: 'Costs', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Costs', exact: true })).toBeVisible();
  await noPageOverflow(page);
});

test('touch feedback honors reduced motion and narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setupWorkspace(page);
  await noPageOverflow(page);
  const firstStep = page.getByRole('button', { name: 'Add your first horse' });
  await firstStep.hover();
  await expect(firstStep).toHaveCSS('transform', 'none');
  await expect(page.locator('.xs-page')).toHaveCSS('animation-name', 'none');
  const create = page.getByRole('button', { name: 'Create', exact: true });
  await create.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await create.click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  await expect(page.getByRole('dialog', { name: 'Add Horse' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Add Horse' })).toBeHidden();
  await expect(page).toHaveURL(/\/app$/);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await firstStep.hover();
  await expect(firstStep).not.toHaveCSS('transform', 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(firstStep).toHaveCSS('transform', 'none');
});

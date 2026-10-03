import { expect, test, type Page } from '@playwright/test';

async function setupHorse(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Action Flow Test');
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
  await expect(page.locator('.xs-objhead__name')).toContainText(/blue dolly/i);
}

async function navigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/app${path}`);
}

for (const width of [1440, 390]) {
  test(`horse quick review retains filters, scroll and keyboard focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupHorse(page);
    await navigate(page, '/horses');
    await page.getByRole('textbox', { name: 'Search horse records' }).fill('Blue');
    const title = page.getByRole('button', { name: 'Quick review Blue Dolly', exact: true });
    await title.scrollIntoViewIfNeeded();
    await title.focus();
    const before = await page.evaluate(() => window.scrollY);
    await title.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Blue Dolly', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/horses\?search=Blue$/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Blue Dolly', exact: true })).toHaveCount(0);
    await expect(title).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Search horse records' })).toHaveValue('Blue');
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await title.click();
    await page
      .getByRole('dialog', { name: 'Blue Dolly', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await expect(title).toBeFocused();
  });
}

test('dashboard missing documents opens the matching horses and a contextual upload', async ({ page }) => {
  await setupHorse(page);
  await navigate(page, '/');
  await page.getByRole('button', { name: /Missing documents/ }).click();
  await expect(page).toHaveURL(/\/horses\?documents=missing$/);
  await expect(page.getByRole('heading', { name: 'Sale document gaps' })).toBeVisible();
  await page.getByRole('link', { name: /Upload .*papers for Blue Dolly/ }).click();
  await expect(page).toHaveURL(/\/documents\?.*horse=.*requirement=aqha-papers/);
  await expect(page.getByLabel('Attach to horse')).toHaveValue(/horse-/);
  await expect(page.getByRole('status').filter({ hasText: /Blue Dolly/ })).toContainText(/papers/);
  await expect(page.getByRole('tab', { name: /Upload/ })).toHaveAttribute('aria-selected', 'true');
});

test('upload blocks repeated submits, preserves failed files, and exposes a real retry result', async ({ page }) => {
  await setupHorse(page);
  await navigate(page, '/documents?upload=1');
  await page.getByLabel('Files', { exact: true }).setInputFiles({
    name: 'Blue-Dolly-registration.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Registration certificate\nHorse name: BLUE DOLLY\nRegistration number: 1234567'),
  });
  // Only this disposable page's file reader fails. The production store and
  // UI run unchanged, including their normal failure response.
  await page.evaluate(() => {
    (window as Window & { fileReadAttempts?: number }).fileReadAttempts = 0;
    Object.defineProperty(File.prototype, 'arrayBuffer', {
      configurable: true,
      value: async function () {
        const state = window as Window & { fileReadAttempts?: number };
        state.fileReadAttempts = (state.fileReadAttempts ?? 0) + 1;
        await new Promise((resolve) => setTimeout(resolve, 600));
        throw new Error('Synthetic unreadable file');
      },
    });
  });
  await page.getByRole('button', { name: 'Add docs', exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByRole('button', { name: 'Adding files…', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Attach to horse')).toBeDisabled();
  await expect(page.getByRole('alert').filter({ hasText: 'Upload needs attention' })).toContainText(
    'file selection is still here',
  );
  expect(
    await page.getByLabel('Files', { exact: true }).evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe('Blue-Dolly-registration.txt');
  expect(await page.evaluate(() => (window as Window & { fileReadAttempts?: number }).fileReadAttempts)).toBe(1);
  await page.evaluate(() => {
    delete (File.prototype as { arrayBuffer?: unknown }).arrayBuffer;
  });
  await page.getByRole('button', { name: 'Retry upload', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Intake finished' })).toContainText(
    '1 file entered the document queue',
  );
  await page.getByRole('tab', { name: /Upload/ }).click();
  await expect(page.getByRole('button', { name: 'Add docs', exact: true })).toBeDisabled();
  expect(
    await page.getByLabel('Files', { exact: true }).evaluate((input: HTMLInputElement) => input.files?.length),
  ).toBe(0);
});

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
  return addHorse(page, 'Blue Dolly');
}

async function addHorse(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse', exact: true });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill(name);
  await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
  const heading = page.locator('.xs-objhead__name');
  await expect(heading).toHaveText(name.toUpperCase());
  return { name: (await heading.innerText()).trim(), id: new URL(page.url()).pathname.split('/').at(-1)! };
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
    const horse = await setupHorse(page);
    await navigate(page, '/horses');
    await page.getByRole('textbox', { name: 'Search horse records' }).fill('Blue');
    const title = page.getByRole('button', { name: `Quick review ${horse.name}`, exact: true });
    await title.scrollIntoViewIfNeeded();
    await title.focus();
    const before = await page.evaluate(() => window.scrollY);
    await title.press('Enter');
    await expect(page.getByRole('dialog', { name: horse.name, exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/horses\?search=Blue$/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: horse.name, exact: true })).toHaveCount(0);
    await expect(title).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Search horse records' })).toHaveValue('Blue');
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await title.click();
    await page
      .getByRole('dialog', { name: horse.name, exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await expect(title).toBeFocused();
  });
}

for (const { label, requirement } of [
  { label: 'Registration papers', requirement: 'aqha-papers' },
  { label: 'Transfer papers', requirement: 'transfer-papers' },
]) {
  test(`dashboard missing documents opens the matching horses and a contextual ${label} upload`, async ({ page }) => {
    const horse = await setupHorse(page);
    await navigate(page, '/');
    await page.getByRole('button', { name: /Missing documents/ }).click();
    await expect(page).toHaveURL(/\/horses\?documents=missing$/);
    await expect(page.getByRole('heading', { name: 'Sale document gaps' })).toBeVisible();
    await page.getByRole('link', { name: `Upload ${label} for ${horse.name}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/documents\\?.*horse=.*requirement=${requirement}`));
    expect(new URL(page.url()).searchParams.get('horse')).toBe(horse.id);
    await expect(page.getByLabel('Attach to horse')).toHaveValue(horse.id);
    await expect(page.getByRole('status').filter({ hasText: horse.name })).toContainText(label);
    await expect(page.getByRole('tab', { name: /Upload/ })).toHaveAttribute('aria-selected', 'true');
  });
}

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

test('changing the contextual upload horse keeps the banner, scope, and saved target aligned', async ({ page }) => {
  const first = await setupHorse(page);
  const second = await addHorse(page, 'Copper Canyon');
  await navigate(page, `/documents?horse=${first.id}&from=profile&requirement=aqha-papers&upload=1`);
  const context = page.locator('.hc-upload-context');
  await expect(context).toContainText(`Upload Registration papers for ${first.name}`);
  await page.getByLabel('Attach to horse').selectOption(second.id);
  await expect(page).toHaveURL(new RegExp(`horse=${second.id}`));
  await expect(context).toContainText(`Upload Registration papers for ${second.name}`);
  await expect(context).not.toContainText(first.name);
  await expect(page.getByText(`Documents for ${second.name} and unassigned uploads`, { exact: true })).toBeVisible();
  await page.getByLabel('Files', { exact: true }).setInputFiles({
    name: 'Copper-Canyon-registration.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Registration certificate\nHorse name: COPPER CANYON\nRegistration number: 1234567'),
  });
  await page.getByRole('button', { name: 'Add docs', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Intake finished' })).toContainText('1 file entered');
  await page.getByRole('tab', { name: /Library/ }).click();
  await expect(page.getByRole('row', { name: /Copper-Canyon-registration.*library actions/ })).toContainText(
    second.name,
  );
  await page.getByRole('tab', { name: /Upload/ }).click();
  await page.getByLabel('Attach to horse').selectOption('');
  await expect(context).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('horse')).toBe(false);
  expect(new URL(page.url()).searchParams.has('requirement')).toBe(false);
});

test('a delayed duplicate upload cannot replace a newer Library stage selection', async ({ page }) => {
  await setupHorse(page);
  await navigate(page, '/documents?upload=1');
  const file = {
    name: 'Blue-Dolly-registration.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Registration certificate\nHorse name: BLUE DOLLY\nRegistration number: 1234567'),
  };
  await page.getByLabel('Files', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: 'Add docs', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Intake finished' })).toBeVisible();
  await page.getByRole('tab', { name: /Upload/ }).click();
  await page.getByLabel('Files', { exact: true }).setInputFiles(file);
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    const gate = new Promise<void>((resolve) => {
      (window as Window & { releaseIntakeRead?: () => void }).releaseIntakeRead = resolve;
    });
    File.prototype.arrayBuffer = async function () {
      await gate;
      return read.call(this);
    };
  });
  await page.getByRole('button', { name: 'Add docs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Adding files…', exact: true })).toBeDisabled();
  const library = page.getByRole('tab', { name: /Library/ });
  await library.click();
  await expect(library).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => (window as Window & { releaseIntakeRead?: () => void }).releaseIntakeRead?.());
  await expect(page.getByRole('status').filter({ hasText: 'Intake finished' })).toContainText('duplicate warning');
  await expect(library).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('row', { name: /Blue-Dolly-registration.*library actions/ })).toHaveCount(2);
});

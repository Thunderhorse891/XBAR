import { expect, test, type Locator, type Page } from '@playwright/test';

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((n) => {
        const value = n / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
async function readablePrimary(control: Locator) {
  const colors = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(contrast(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
}
async function noOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}
async function createFixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Cedar Ridge');
  await page.getByPlaceholder('Primary Ranch').fill('Cedar Ridge Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Example Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('preview@example.test');
  await page.getByPlaceholder('Legal owner').fill('Cedar Ridge');
  await page.getByPlaceholder('Owner entity').fill('Cedar Ridge');
  await page.getByPlaceholder('Barn A').fill('Main Barn');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

for (const width of [390, 1440]) {
  test(`hero controls preserve artwork and clear hierarchy at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Every horse. One clear picture.');
    const art = page.locator('.landing-horse');
    await expect(art).toHaveAttribute('src', '/brand/xbar-report-horse.png');
    await art.evaluate((image: HTMLImageElement) => image.decode());
    const primary = page.locator('.landing-actions .landing-primary');
    const secondary = page.locator('.landing-actions .landing-text-link');
    for (const control of [primary, secondary]) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.width).toBeGreaterThanOrEqual(48);
    }
    if (width === 390) {
      const a = (await primary.boundingBox())!,
        b = (await secondary.boundingBox())!;
      expect(a.width).toBeCloseTo(b.width, 0);
      expect(b.y - a.y - a.height).toBeGreaterThanOrEqual(10);
    }
    await readablePrimary(primary);
    await primary.focus();
    await page.keyboard.press('Tab');
    await expect(secondary).toBeFocused();
    await expect(secondary).toHaveCSS('outline-style', 'solid');
    expect(
      await secondary.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth)),
    ).toBeGreaterThanOrEqual(2);
    await noOverflow(page, width);
    await page.screenshot({ path: info.outputPath(`workspace-polish-hero-${width}.png`), fullPage: false });
  });

  test(`horse cards keep clear actions and readable facts at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createFixture(page);
    await page.goto('/app/horses');
    await expect(page.locator('.hc-onboard')).toBeVisible();
    await noOverflow(page, width);
    await page.screenshot({ path: info.outputPath(`workspace-polish-empty-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add Horse', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Add Horse', exact: true });
    await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('Copper Canyon');
    await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
    await expect(page).toHaveURL(/\/horses\//);
    await page.goto('/app/horses');
    const card = page.locator('.horse-card');
    await expect(card).toHaveCount(1);
    const actions = card.locator('.horse-card__footer .inline-actions');
    const record = actions.getByRole('link', { name: 'Horse record', exact: true });
    const quick = actions.getByRole('button', { name: 'Quick review', exact: true });
    for (const control of await actions.locator('.button').all()) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(control).toHaveCSS('box-shadow', 'none');
    }
    expect((await record.boundingBox())!.width).toBeCloseTo((await actions.boundingBox())!.width, 0);
    await readablePrimary(record);
    await quick.focus();
    await expect(quick).toBeFocused();
    expect(
      await quick.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth)),
    ).toBeGreaterThanOrEqual(2);
    await expect(card.locator('.horse-card__fact').filter({ hasText: 'Legal owner' })).toContainText(
      'Cedar Ridge Ranch',
    );
    await expect(card.locator('.horse-card__fact').filter({ hasText: 'Registry' })).toContainText('Pending');
    await noOverflow(page, width);
    await page.screenshot({ path: info.outputPath(`workspace-polish-card-${width}.png`), fullPage: true });
  });
}

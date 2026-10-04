import { expect, test, type Locator } from '@playwright/test';

async function expectOriginalArtwork(svg: Locator, verifyDecode = true) {
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute('viewBox', '0 0 1672 941');
  await expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  await expect(svg.locator('image')).toHaveAttribute('href', '/brand/xbar-original-lockup-480.png');
  await expect(svg.locator('image')).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  if (verifyDecode) {
    const loaded = await svg.locator('image').evaluate(
      (element) =>
        new Promise<boolean>((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image.naturalWidth === 480 && image.naturalHeight === 270);
          image.onerror = () => resolve(false);
          image.src = element.getAttribute('href')!;
        }),
    );
    expect(loaded, 'the original raster must actually decode, not merely occupy an SVG box').toBe(true);
  }
  await expect(svg.locator('path, text, foreignObject')).toHaveCount(0);
  const bounds = await svg.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width / bounds!.height).toBeCloseTo(1672 / 941, 1);
  expect(await svg.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/metrics', (route) => route.fulfill({ status: 204 }));
  await page.setViewportSize({ width: 1440, height: 900 });
});

for (const width of [1440, 390, 320]) {
  test(`original B artwork remains complete in public navigation at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/features');
    const logo = page.locator('.site-header [data-xbar-signature]');
    await expectOriginalArtwork(logo);
    await logo.hover();
    await expectOriginalArtwork(logo);
    await expect(logo).not.toHaveAttribute('data-tracing', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: info.outputPath(`workspace-signature-original-b-public-${width}.png`),
      fullPage: false,
    });
  });
}

test('hero uses the unchanged original with no approximate outline overlay', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.landing-horse')).toHaveAttribute('src', '/brand/xbar-report-horse.png');
  await page.locator('.landing-horse').evaluate((image: HTMLImageElement) => image.decode());
  await expect(page.locator('.xbar-signature--hero, .xbar-signature__trace')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('workspace-signature-original-b-home.png') });
});

test('original artwork remains recognizable with JavaScript disabled', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    // Observe the real browser image request; an onload callback created inside
    // the page cannot fire when scripting is disabled.
    const original = page.waitForResponse(
      (response) =>
        response.url().endsWith('/brand/xbar-original-lockup-480.png') && response.request().resourceType() === 'image',
    );
    await page.goto('/features');
    const imageResponse = await original;
    expect(imageResponse.ok()).toBe(true);
    const bytes = await imageResponse.body();
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(480);
    expect(bytes.readUInt32BE(20)).toBe(270);
    await expectOriginalArtwork(page.locator('.site-header [data-xbar-signature]'), false);
    await page.screenshot({ path: info.outputPath('workspace-signature-original-b-no-javascript.png') });
    await page.getByRole('link', { name: 'XBAR home', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.landing-horse')).toHaveAttribute('src', '/brand/xbar-report-horse.png');
  } finally {
    await context.close();
  }
});

for (const pathname of ['/app/login', '/app/setup', '/app/reset-password']) {
  test(`${pathname} contains the complete original B artwork in its auth badge`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
    await page.goto(pathname);
    const badge = page.locator('.clean-brand__mark');
    const logo = badge.locator('[data-xbar-signature]');
    await expectOriginalArtwork(logo);
    const outer = await badge.boundingBox();
    const inner = await logo.boundingBox();
    expect(outer).not.toBeNull();
    expect(inner).not.toBeNull();
    expect(inner!.x).toBeGreaterThanOrEqual(outer!.x);
    expect(inner!.y).toBeGreaterThanOrEqual(outer!.y);
    expect(inner!.x + inner!.width).toBeLessThanOrEqual(outer!.x + outer!.width);
    expect(inner!.y + inner!.height).toBeLessThanOrEqual(outer!.y + outer!.height);
    await page.screenshot({
      path: info.outputPath(`workspace-signature-original-b-${pathname.split('/').pop()}.png`),
      fullPage: true,
    });
  });
}

function contrastRatio(first: string, second: string) {
  const luminance = (color: string) => {
    const rgb = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    expect(rgb).toHaveLength(3);
    const linear = rgb!.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const width of [1180, 390]) {
  test(`login artwork and copy keep separate readable rows at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1180 ? 757 : 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app/login');
    const panel = page.locator('.clean-login-visual');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS('background-color', 'rgb(23, 27, 32)');
    const artwork = await panel.locator('.clean-login-visual__art').boundingBox();
    const copy = await panel.locator('.clean-login-visual__copy').boundingBox();
    expect(artwork).not.toBeNull();
    expect(copy).not.toBeNull();
    expect(artwork!.y + artwork!.height).toBeLessThanOrEqual(copy!.y);
    const colors = await panel.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      copy: getComputedStyle(element.querySelector('p')!).color,
      feature: getComputedStyle(element.querySelector('li')!).color,
    }));
    expect(contrastRatio(colors.copy, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.feature, colors.background)).toBeGreaterThanOrEqual(4.5);
    await expect(page.getByRole('heading', { name: 'Sign In', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`workspace-signature-login-${width}.png`), fullPage: true });
  });
}

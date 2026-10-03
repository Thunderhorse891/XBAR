import { expect, test, type Locator } from '@playwright/test';

type TraceCall = { duration: number; delay: number; iterations: number; frames: Keyframe[] };
type SignatureWindow = Window & { __signatureCalls: TraceCall[] };

async function expectStaticSignature(svg: Locator) {
  await expect(svg).toBeVisible();
  await expect(svg.locator('image, text, foreignObject')).toHaveCount(0);
  const base = svg.locator('.xbar-signature__base');
  await expect(base).toBeVisible();
  const state = await base.evaluate((element: SVGGraphicsElement) => {
    const style = getComputedStyle(element);
    const shape = element.getBBox();
    return {
      width: shape.width,
      height: shape.height,
      opacity: Number(style.opacity),
      display: style.display,
      visibility: style.visibility,
      fill: style.fill,
      stroke: style.stroke,
    };
  });
  expect(state.width).toBeGreaterThan(0);
  expect(state.height).toBeGreaterThan(0);
  expect(state.opacity).toBeGreaterThan(0);
  expect(state.display).not.toBe('none');
  expect(state.visibility).not.toBe('hidden');
  expect(state.fill !== 'none' || state.stroke !== 'none').toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/metrics', (route) => route.fulfill({ status: 204 }));
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('the horse signature traces true paths once on entry and once on fine-pointer hover for 1.5 seconds', async ({
  page,
}) => {
  // Record native Animation timing even if font/network load makes navigation
  // finish after the entrance. The target is a real SVG path, never a raster.
  await page.addInitScript(() => {
    const calls: TraceCall[] = [];
    (window as unknown as SignatureWindow).__signatureCalls = calls;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      if (this.matches('path.xbar-signature__trace') && this.closest('.site-header')) {
        const timing = animation.effect!.getTiming();
        calls.push({
          duration: Number(timing.duration),
          delay: Number(timing.delay),
          iterations: Number(timing.iterations),
          frames: (animation.effect as KeyframeEffect).getKeyframes(),
        });
      }
      return animation;
    };
  });
  await page.goto('/features');
  const svg = page.locator('.site-header [data-xbar-signature]');
  await expectStaticSignature(svg);
  const pathCount = await svg.locator('path.xbar-signature__trace').count();
  expect(pathCount).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as SignatureWindow).__signatureCalls.length))
    .toBe(pathCount);
  const entry = await page.evaluate(() => (window as unknown as SignatureWindow).__signatureCalls);
  expect(Math.max(...entry.map((call) => call.delay + call.duration))).toBeCloseTo(1500, 5);
  expect(entry.every((call) => call.iterations === 1)).toBe(true);
  expect(entry.every((call) => call.frames.some((frame) => 'strokeDashoffset' in frame))).toBe(true);
  expect(entry.every((call) => call.frames.every((frame) => !('transform' in frame)))).toBe(true);
  await expect(svg).not.toHaveAttribute('data-tracing', 'true', { timeout: 2000 });
  expect(await svg.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await expectStaticSignature(svg);

  await page.mouse.move(1400, 880);
  await svg.hover();
  await expect(svg).toHaveAttribute('data-tracing', 'true');
  const replay = await page.evaluate(() => (window as unknown as SignatureWindow).__signatureCalls);
  expect(replay).toHaveLength(pathCount * 2);
  expect(Math.max(...replay.slice(pathCount).map((call) => call.delay + call.duration))).toBeCloseTo(1500, 5);
  await expect(svg).not.toHaveAttribute('data-tracing', 'true', { timeout: 2000 });
  expect(await svg.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as SignatureWindow).__signatureCalls.length)).toBe(pathCount * 2);
  await expectStaticSignature(svg);
});

test('the homepage outline overlays the original horse with matching source coordinates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const hero = page.locator('.xbar-signature--hero');
  await expectStaticSignature(hero);
  await expect(hero).toHaveAttribute('viewBox', '0 0 1672 941');
  const image = page.locator('.landing-horse');
  await expect(image).toHaveAttribute('src', '/brand/xbar-report-horse.png');
  const imageBounds = await image.boundingBox();
  const overlayBounds = await hero.boundingBox();
  expect(imageBounds).not.toBeNull();
  expect(overlayBounds).not.toBeNull();
  expect(overlayBounds!.x).toBeCloseTo(imageBounds!.x, 0);
  expect(overlayBounds!.y).toBeCloseTo(imageBounds!.y, 0);
  expect(overlayBounds!.width).toBeCloseTo(imageBounds!.width, 0);
  expect(overlayBounds!.height).toBeCloseTo(imageBounds!.height, 0);
  expect(
    await hero
      .locator('path.xbar-signature__trace')
      .evaluateAll((paths) => paths.every((path) => path.getAttribute('pathLength') === '1')),
  ).toBe(true);
});

test('reduced motion leaves recognizable static signatures and suppresses hover replay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/features');
  const signature = page.locator('.site-header [data-xbar-signature]');
  await expectStaticSignature(signature);
  await signature.hover();
  await expect(signature).not.toHaveAttribute('data-tracing', 'true');
  expect(await signature.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await expectStaticSignature(signature);
});

test('enabling reduced motion during a trace immediately restores the static mark', async ({ page }) => {
  await page.goto('/features');
  const signature = page.locator('.site-header [data-xbar-signature]');
  await expect(signature).not.toHaveAttribute('data-tracing', 'true', { timeout: 2000 });
  await signature.hover();
  await expect(signature).toHaveAttribute('data-tracing', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(signature).not.toHaveAttribute('data-tracing', 'true');
  expect(await signature.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await expectStaticSignature(signature);
});

test('homepage pause stops every signature highlight and prevents hover replay', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-landing-motion', 'off');
  const hero = page.locator('.xbar-signature--hero');
  await expectStaticSignature(hero);
  await hero.hover();
  await expect(page.locator('[data-xbar-signature][data-tracing="true"]')).toHaveCount(0);
  const running = await page
    .locator('[data-xbar-signature]')
    .evaluateAll(
      (elements) =>
        elements
          .flatMap((element) => element.getAnimations({ subtree: true }))
          .filter((animation) => animation.playState === 'running').length,
    );
  expect(running).toBe(0);
});

test('signatures remain recognizable with JavaScript disabled or the shared bundle unavailable', async ({
  browser,
  baseURL,
  page,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const noScript = await context.newPage();
    await noScript.goto('/features');
    await expectStaticSignature(noScript.locator('.site-header [data-xbar-signature]'));
    await noScript.getByRole('link', { name: 'XBAR home', exact: true }).click();
    await expect(noScript).toHaveURL(/\/$/);
    await expectStaticSignature(noScript.locator('.xbar-signature--hero'));
  } finally {
    await context.close();
  }
  await page.route('**/brand-motion/*.js', (route) => route.abort());
  await page.goto('/features');
  await expectStaticSignature(page.locator('.site-header [data-xbar-signature]'));
  await expect(page.locator('[data-xbar-signature][data-tracing="true"]')).toHaveCount(0);
});

test('data saving and touch input preserve the static signature without replay', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true, addEventListener() {}, removeEventListener() {} },
      });
    });
    const page = await context.newPage();
    await page.route('**/api/metrics', (route) => route.fulfill({ status: 204 }));
    await page.goto('/features');
    const signature = page.locator('.site-header [data-xbar-signature]');
    await expectStaticSignature(signature);
    await signature.dispatchEvent('pointerenter', { pointerType: 'touch' });
    await expect(signature).not.toHaveAttribute('data-tracing', 'true');
    expect(await signature.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  } finally {
    await context.close();
  }
});

test('signature review captures show static recognition, a real 750ms trace, and a settled 1500ms mark', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.landing-horse-light')).toHaveCount(0);
  const hero = page.locator('.xbar-signature--hero');
  await expectStaticSignature(hero);
  await page.locator('.landing-horse').evaluate((image: HTMLImageElement) => image.decode());
  await page.screenshot({ path: info.outputPath('workspace-signature-home-static.png'), animations: 'allow' });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByRole('button', { name: 'Pause motion' })).toBeVisible();
  // Let normal entrance animations settle before isolating the signature.
  await expect
    .poll(() =>
      page
        .locator('[data-hero-reveal]')
        .evaluateAll((elements) => elements.flatMap((element) => element.getAnimations()).length),
    )
    .toBe(0);
  await page.mouse.move(1400, 880);
  await hero.hover();
  await expect(hero).toHaveAttribute('data-tracing', 'true');
  const count = await hero.evaluate((element) => {
    const animations = element.getAnimations({ subtree: true });
    (element as SVGSVGElement & { reviewAnimations: Animation[] }).reviewAnimations = animations;
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 750;
    }
    return animations.length;
  });
  expect(count).toBeGreaterThan(0);
  await expect
    .poll(() =>
      hero
        .locator('.xbar-signature__trace')
        .evaluateAll((paths) => paths.some((path) => Number(getComputedStyle(path).opacity) > 0)),
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath('workspace-signature-home-trace-750ms.png'), animations: 'allow' });

  await hero.evaluate((element) => {
    const reviewed = element as SVGSVGElement & { reviewAnimations?: Animation[] };
    for (const animation of reviewed.reviewAnimations ?? []) {
      animation.currentTime = 1500;
      animation.finish();
    }
    delete reviewed.reviewAnimations;
  });
  await expect(hero).not.toHaveAttribute('data-tracing', 'true');
  expect(await hero.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await expectStaticSignature(hero);
  await page.screenshot({ path: info.outputPath('workspace-signature-home-settled-1500ms.png'), animations: 'allow' });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/features');
  await expectStaticSignature(page.locator('.site-header [data-xbar-signature]'));
  await expect(page.locator('[data-xbar-signature][data-tracing="true"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('workspace-signature-mobile-header.png'), animations: 'allow' });
});

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

for (const pathname of ['/app/login', '/app/setup', '/app/reset-password']) {
  test(`${pathname} contains an uncropped high-contrast static signature in its auth badge`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
    await page.goto(pathname);
    const badge = page.locator('.clean-brand__mark');
    const signature = badge.locator('[data-xbar-signature]');
    await expectStaticSignature(signature);
    await expect(signature).toHaveAttribute('width', '32');
    await expect(signature).toHaveAttribute('height', '32');
    const badgeBounds = await badge.boundingBox();
    const markBounds = await signature.boundingBox();
    expect(badgeBounds).not.toBeNull();
    expect(markBounds).not.toBeNull();
    expect(markBounds!.width).toBe(32);
    expect(markBounds!.height).toBe(32);
    expect(markBounds!.x).toBeGreaterThanOrEqual(badgeBounds!.x);
    expect(markBounds!.y).toBeGreaterThanOrEqual(badgeBounds!.y);
    expect(markBounds!.x + markBounds!.width).toBeLessThanOrEqual(badgeBounds!.x + badgeBounds!.width);
    expect(markBounds!.y + markBounds!.height).toBeLessThanOrEqual(badgeBounds!.y + badgeBounds!.height);
    const colors = await badge.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      mark: getComputedStyle(element.querySelector('[data-xbar-signature]')!).color,
    }));
    expect(colors.mark).toBe('rgb(214, 221, 229)');
    expect(contrastRatio(colors.mark, colors.background)).toBeGreaterThanOrEqual(3);
    expect(await signature.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  });
}

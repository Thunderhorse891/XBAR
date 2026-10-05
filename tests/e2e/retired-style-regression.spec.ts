import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Exact removed stylesheet from main c20f601. Kept only as regression input,
// never imported by the application or marketing build.
const retiredCss = readFileSync('tests/e2e/fixtures/retired-premium-operating-system.css', 'utf8');

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`retired shell CSS changes no rendered pixels at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
    await page.goto('/app/setup');
    await page.getByPlaceholder('XBAR LLC').fill('Style Test');
    await page.getByPlaceholder('Primary Ranch').fill('Style Ranch');
    await page.getByPlaceholder('Ranch manager').fill('Test Manager');
    await page.getByPlaceholder('ops@yourranch.com').fill('style@example.test');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/app$/);
    for (const route of ['', '/health-care', '/breeding-foaling', '/equipment']) {
      await page.goto(`/app${route}`);
      await expect(page.locator('main h1')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('.xbar-command-shell, .xbar-command-topbar')).toHaveCount(0);
      const style = await page.addStyleTag({ content: retiredCss });
      const name = route.slice(1) || 'dashboard';
      const before = await page.screenshot({
        path: testInfo.outputPath(`ranch-style-${name}-before.png`),
        animations: 'disabled',
      });
      await style.evaluate((element) => element.parentNode?.removeChild(element));
      const after = await page.screenshot({
        path: testInfo.outputPath(`ranch-style-${name}-after.png`),
        animations: 'disabled',
      });
      expect(after.equals(before), `${name} changed when unused CSS was removed`).toBe(true);
    }
  });
}

import { expect, test, type Locator } from '@playwright/test';

async function visibleOutline(control: Locator) {
  await expect(control).toHaveCSS('outline-style', 'solid');
  expect(await control.evaluate((node) => parseFloat(getComputedStyle(node).outlineWidth))).toBeGreaterThanOrEqual(2);
}

for (const width of [390, 1440]) {
  for (const forcedColors of ['none', 'active'] as const) {
    for (const mode of ['signin', 'signup']) {
      test(`${mode} fields keep keyboard focus at ${width}px with forced colors ${forcedColors}`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ forcedColors, reducedMotion: 'reduce' });
        // Local-only built bundle: no account, email delivery or provider request.
        await page.goto(`/app/login?mode=${mode}`);
        const email = page.getByRole('textbox', { name: 'Email or User ID', exact: true });
        const password = page.getByLabel('Password', { exact: true });
        await email.focus();
        await expect(email).toBeFocused();
        await expect(email).toHaveJSProperty('value', '');
        await page.screenshot({ path: info.outputPath(`workspace-entry-focus-${mode}-${width}-${forcedColors}.png`) });
        await visibleOutline(email);
        await page.keyboard.press('Tab');
        await expect(password).toBeFocused();
        // The input lives inside overflow:hidden: the wrapper must show a ring outside it.
        await visibleOutline(page.locator('.clean-password-field'));
        await page.screenshot({
          path: info.outputPath(`workspace-entry-password-${mode}-${width}-${forcedColors}.png`),
        });
        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: 'Show entered value', exact: true })).toBeFocused();
        await visibleOutline(page.locator('.clean-password-field'));
        await page.keyboard.press('Shift+Tab');
        await expect(password).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      });
    }
  }
}

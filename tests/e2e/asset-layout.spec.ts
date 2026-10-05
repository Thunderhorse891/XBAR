import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`equipment creation keeps the asset editor inside ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
    await page.goto('/app/setup');
    await page.getByPlaceholder('XBAR LLC').fill('Asset Layout');
    await page.getByPlaceholder('Primary Ranch').fill('Layout Ranch');
    await page.getByPlaceholder('Ranch manager').fill('Test Manager');
    await page.getByPlaceholder('ops@yourranch.com').fill('layout@example.test');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/equipment');
    await page.getByRole('button', { name: 'Add Equipment', exact: true }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Add Equipment' });
    await drawer.getByPlaceholder('e.g. Stock trailer (24ft)').fill('Feedback trailer');
    await drawer.getByRole('button', { name: 'Add Equipment', exact: true }).click();
    await expect(page).toHaveURL(/\/assets\?asset=/);
    const register = page.getByRole('region', { name: 'Asset register', exact: true });
    await expect(register.getByRole('cell', { name: 'Feedback trailer', exact: true })).toBeVisible();
    const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
    await expect.poll(pageWidth).toBeLessThanOrEqual(viewport.width);
    for (const control of [
      page.getByRole('combobox', { name: 'Asset', exact: true }),
      page.getByRole('textbox', { name: 'Notes', exact: true }),
      page.getByRole('button', { name: 'Save asset changes', exact: true }),
    ]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
    await register.focus();
    await expect(register).toBeFocused();
    const tableOverflows = await register.evaluate((element) => element.scrollWidth > element.clientWidth);
    if (viewport.width === 390) expect(tableOverflows).toBe(true);
    if (tableOverflows) {
      await register.press('ArrowRight');
      await expect.poll(() => register.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await register.evaluate((element) => {
        element.scrollLeft = 0;
      });
    }
    await page.screenshot({ path: testInfo.outputPath(`ranch-assets-layout-${viewport.width}.png`), fullPage: true });
    if (viewport.width === 390) {
      // Restore the previous grid-item minimum to demonstrate the exact defect
      // with the same rendered route and fixture, without changing app data.
      const oldMinimum = await page.addStyleTag({ content: '.ranch-assets-layout > .panel { min-width: auto; }' });
      await expect.poll(pageWidth).toBeGreaterThan(viewport.width);
      await page.screenshot({ path: testInfo.outputPath('ranch-assets-layout-before-390.png'), fullPage: true });
      await oldMinimum.evaluate((element) => element.parentNode?.removeChild(element));
      await expect.poll(pageWidth).toBeLessThanOrEqual(viewport.width);
    }
    await page.reload();
    await expect(register.getByRole('cell', { name: 'Feedback trailer', exact: true })).toBeVisible();
    await expect.poll(pageWidth).toBeLessThanOrEqual(viewport.width);
  });
}

import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`public support is usable without sign-in at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const response = await page.goto('/support');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('XBAR Support | Account, Records and Files');
    await expect(page.getByRole('heading', { level: 1, name: 'Help with XBAR.' })).toBeVisible();
    const contact = page.getByRole('link', { name: 'Email support', exact: true });
    await expect(contact).toHaveAttribute('href', 'mailto:xbarje@gmail.com');
    await expect(contact).toBeVisible();
    await expect(page.locator('main')).toContainText('Never send passwords or sign-in codes.');
    await expect(page.locator('main')).toContainText('Do not clear app or browser storage');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath(`support-${width}.png`), fullPage: true });
    await page.locator('main a[href="/privacy"]').click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
    await page.goBack();
    await page.locator('main a[href="/terms"]').click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
  });
}

import { expect, test } from '@playwright/test';

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`capture exact base revision on ${viewport.name}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
    for (const [name, url] of [
      ['home', '/'],
      ['pricing', '/pricing'],
      ['login', '/app/login'],
      ['setup', '/app/setup'],
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading').first()).toBeVisible();
      await page.screenshot({ path: info.outputPath(`workspace-before-${name}-${viewport.name}.png`) });
    }
    await page.getByPlaceholder('XBAR LLC').fill('Cedar Ridge');
    await page.getByPlaceholder('Primary Ranch').fill('Cedar Ridge Ranch');
    await page.getByPlaceholder('Ranch manager').fill('Example Manager');
    await page.getByPlaceholder('ops@yourranch.com').fill('preview@example.test');
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`workspace-before-dashboard-${viewport.name}.png`) });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add Horse' }).click();
    const form = page.getByRole('dialog', { name: 'Add Horse' });
    await form.getByPlaceholder('e.g. THR Copper Canyon').fill('Copper Canyon');
    await form.getByRole('button', { name: 'Add Horse', exact: true }).click();
    await expect(page.locator('.xs-objhead__name')).toHaveText(/copper canyon/i);
    for (const close of await page.getByRole('button', { name: 'Close toast', exact: true }).all()) {
      if (await close.isVisible()) await close.click();
    }
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`workspace-before-horse-${viewport.name}.png`) });
    for (const route of ['horses', 'documents', 'reports', 'billing', 'reminders']) {
      await page.goto(`/app/${route}`);
      await expect(page.locator('main.xs-page').getByRole('heading').first()).toBeVisible();
      await page.screenshot({ path: info.outputPath(`workspace-before-${route}-${viewport.name}.png`) });
    }
  });
}

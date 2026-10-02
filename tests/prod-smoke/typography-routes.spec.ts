import { expect, test, type Page } from '@playwright/test';

const routes = [
  '',
  'today',
  'horses',
  'herd-groups',
  'pastures',
  'health-care',
  'breeding-foaling',
  'feed',
  'financials',
  'costs',
  'sales',
  'buyers',
  'sale-packets',
  'ownership-chain',
  'documents',
  'expiring',
  'reminders',
  'equipment',
  'expenses',
  'reports',
  'settings',
  'billing',
  'getting-started',
];

async function prepareExampleWorkspace(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Cedar Ridge');
  await page.getByPlaceholder('Primary Ranch').fill('Cedar Ridge Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Example Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('preview@example.test');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible();
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`all workspace routes share readable typography on ${viewport.name}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await prepareExampleWorkspace(page);
    for (const route of routes) {
      await test.step(route || 'dashboard', async () => {
        await page.goto(`/app${route ? `/${route}` : ''}`);
        const content = page.locator('main.xs-page');
        await expect(content).toBeVisible();
        await expect(content.getByRole('heading').first()).toBeVisible();
        await expect(content).not.toContainText('Something went wrong');
        const headings = await content.locator('h1, h2, h3').evaluateAll((elements) =>
          elements
            .filter((element) => element.getBoundingClientRect().height > 0)
            .map((element) => {
              const style = getComputedStyle(element);
              return { text: element.textContent?.trim(), font: style.fontFamily, weight: style.fontWeight };
            }),
        );
        for (const heading of headings) {
          expect(heading.font, `${route}: ${heading.text}`).toContain('Outfit');
          expect(heading.weight, `${route}: ${heading.text}`).toBe('600');
        }
        const width = await page.evaluate(() => ({
          viewport: window.innerWidth,
          content: document.documentElement.scrollWidth,
        }));
        expect(width.content, `page overflow on ${route}`).toBeLessThanOrEqual(width.viewport);
        await page.screenshot({
          path: info.outputPath(`workspace-route-${route || 'dashboard'}-${viewport.name}.png`),
        });
      });
    }
  });
}

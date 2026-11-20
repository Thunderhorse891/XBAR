import { test, expect } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`synthetic Ranch Copilot plan, evidence, repeat and discard at ${width}px`, async ({ page }) => {
    test.info().annotations.push({
      type: 'scope',
      description: 'Synthetic fixture only. No auth, payments, or cloud persistence.',
    });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && !r.url().includes('/api/telemetry'))
        writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await page.goto('/copilot-demo');
    await expect(page.getByRole('heading', { name: 'From horse records to a clear next step' })).toBeVisible();
    await expect(page.getByText(/Rule-based review; no AI model is connected/)).toBeVisible();
    const before = await page.evaluate(() => JSON.stringify(localStorage));
    await page.getByRole('button', { name: 'Build action plan', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Action plan for Copper Creek Demo' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Resolve conflicting horse evidence' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Coggins: plan renewal' })).toBeVisible();
    const source = page.getByRole('link', { name: 'Fictional registration — conflicting number' }).first();
    await source.click();
    await expect(page.locator('#copilot-source-2')).toBeInViewport();
    await expect(page.locator('#copilot-source-2')).toContainText('7654321');
    await page.getByRole('button', { name: 'Prepare draft checklist' }).click();
    const draft = page.getByLabel('Draft checklist — review before use');
    const first = await draft.inputValue();
    expect(first).toContain('DRAFT');
    expect(first).toContain('Fictional Coggins');
    await page.getByRole('button', { name: 'Discard draft' }).click();
    await expect(draft).toHaveCount(0);
    await page.getByRole('button', { name: 'Build action plan', exact: true }).click();
    await page.getByRole('button', { name: 'Prepare draft checklist' }).click();
    await expect(draft).toHaveValue(first);
    await page.getByRole('button', { name: 'Close plan' }).click();
    await expect(draft).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(before);
    expect(writes).toEqual([]);
    await page.getByRole('button', { name: 'Build action plan', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`workspace-copilot-${width}.png`), fullPage: true });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Action plan for Copper Creek Demo' })).toHaveCount(0);
  });
}

test('mobile same-nickname fixtures preserve horse identity and unrelated gaps', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && !r.url().includes('/api/telemetry')) writes.push(r.method());
  });
  await page.goto('/copilot-demo');
  const before = await page.evaluate(() => JSON.stringify(localStorage));
  const build = () => page.getByRole('button', { name: 'Build action plan', exact: true }).click();
  await build();
  await page.getByRole('link', { name: 'Fictional registration — conflicting number' }).first().click();
  await expect(page.locator('#copilot-source-2')).toContainText('7654321');
  await expect(page.locator('#copilot-source-0')).toContainText('1234567');
  await page.getByLabel('Evidence fixture').selectOption('after');
  await build();
  await expect(page.getByRole('heading', { name: 'Resolve conflicting horse evidence' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /transfer/i }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Coggins: plan renewal' })).toBeVisible();
  await expect(page.locator('#copilot-source-2')).toContainText('1234567');
  await page.getByLabel('Fictional horse').selectOption('copilot-fictional-ridge');
  await build();
  await expect(page.getByRole('heading', { name: 'Action plan for Copper Ridge Demo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resolve conflicting horse evidence' })).toBeVisible();
  await expect(page.locator('#copilot-source-0')).toContainText('2222222');
  await expect(page.locator('#copilot-source-2')).toContainText('7654321');
  await page.getByRole('button', { name: 'Prepare draft checklist' }).click();
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page.getByRole('button', { name: 'Close plan' }).click();
  await build();
  await expect(page.getByRole('heading', { name: 'Resolve conflicting horse evidence' })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(before);
  expect(writes).toEqual([]);
});

test('public demo is isolated from app services and preserves existing public routes', async ({ page }) => {
  const external = [] as string[];
  page.on('request', (r) => {
    if (r.url().startsWith('http') && !new URL(r.url()).pathname.startsWith('/copilot-demo'))
      external.push(new URL(r.url()).pathname);
  });
  const response = await page.goto('/copilot-demo');
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    /connect-src 'none'/,
  );
  await expect(page.getByRole('button', { name: 'Build action plan', exact: true })).toBeVisible();
  expect(external).toEqual([]);
  for (const path of ['/', '/pricing', '/privacy', '/app/login']) {
    const r = await page.goto(path);
    expect(r?.status()).toBe(200);
    await expect(page.locator('body')).not.toBeEmpty();
  }
});

import { expect, test } from '@playwright/test';

test('public pricing keeps canonical monthly prices and honest billing terms at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'A plan for your horses. Room for your ranch.' })).toBeVisible();
  await expect(
    page.getByText(
      'Prices in USD. Monthly rates are shown on the cards; annual rates are listed below. Confirm your billing period and total at checkout.',
    ),
  ).toBeVisible();
  for (const [tier, price] of [
    ['Starter', '12'],
    ['Professional', '29'],
    ['Ranch Ops', '79'],
    ['Enterprise', '199'],
  ]) {
    const card = page.locator('.plan').filter({ has: page.getByRole('heading', { name: tier, exact: true }) });
    await expect(card.locator('.plan__price')).toHaveText(`$${price}/month`);
    const cta = card.getByRole('link', { name: `Choose ${tier}` });
    const href = await cta.getAttribute('href');
    const url = new URL(href!, 'https://xbar.test');
    expect(url.pathname).toBe('/app/login');
    expect(url.searchParams.get('plan')).toBe(tier);
    expect(url.searchParams.get('mode')).toBe('signup');
    expect((await cta.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }
  for (const question of [
    'Can I cancel anytime?',
    'What happens to my records if I cancel?',
    'Do you offer annual billing?',
  ]) {
    await page.getByText(question, { exact: true }).click();
  }
  await expect(
    page.getByText(
      'The table lists annual prices alongside monthly rates. Checkout confirms availability and the final amount before you pay.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Annual price (2 months free)' }).getByRole('cell')).toHaveText([
    '$120',
    '$290',
    '$790',
    '$1990',
  ]);
  await expect(page.getByText(/Canceling a plan does not delete your ranch records/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

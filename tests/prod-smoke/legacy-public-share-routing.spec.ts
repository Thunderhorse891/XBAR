import { expect, test } from '@playwright/test';

for (const prefix of ['/', '/app', '/app/']) {
  test(`an already-issued ${prefix} hash profile link reaches the public buyer screen`, async ({ page }) => {
    const profile = '00000000-0000-0000-0000-000000000000';
    const token = 'synthetic legacy token / + # &';
    const query = `?view=buyer&t=${encodeURIComponent(token)}`;
    await page.goto(`${prefix}#/profiles/${profile}${query}`);
    await expect(page.getByRole('heading', { name: 'Sale profile unavailable', exact: true })).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe(`/app/profiles/${profile}`);
    expect(url.search).toBe(query);
    expect(url.searchParams.get('t')).toBe(token);
    expect(url.hash).toBe('');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sale profile unavailable', exact: true })).toBeVisible();
  });
}

import { expect, test } from '@playwright/test';
import { buildPublicShareUrl } from '../../src/lib/facebookSharing.js';

test('a generated public share path loads the buyer screen in the built web deployment', async ({ page }) => {
  // Exercise the real no-window fallback against the production server layout:
  // / is marketing, /app owns BrowserRouter. A hash-only link returns HTTP 200
  // for the wrong page, so assert the actual rendered buyer screen and reload.
  const token = 'synthetic share routing token';
  const url = buildPublicShareUrl('/profiles/00000000-0000-0000-0000-000000000000', token);
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Sale profile unavailable', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/app/profiles/00000000-0000-0000-0000-000000000000');
  expect(new URL(page.url()).searchParams.get('t')).toBe(token);
  expect(new URL(page.url()).hash).toBe('');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sale profile unavailable', exact: true })).toBeVisible();
});

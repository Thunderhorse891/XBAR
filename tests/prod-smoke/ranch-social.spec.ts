import { expect, test } from '@playwright/test';

test('ranch links validate, persist, open safely, and support removal on a small screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Social Test Ranch');
  await page.getByPlaceholder('Primary Ranch').fill('Social Test Ranch');
  await page.getByPlaceholder('Legal owner').fill('Test Owner');
  await page.getByPlaceholder('Owner entity').fill('Test Ranch');
  await page.getByPlaceholder('Barn A').fill('Main');
  await page.getByPlaceholder('Pasture 1').fill('North');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.evaluate(() => {
    window.history.pushState({}, '', '/app/sales');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.getByRole('link', { name: 'Manage social links' }).click();
  await expect(page.locator('#ranch-social-profiles')).toBeFocused();
  await page.getByLabel('Instagram profile URL').fill('https://evil.test/ranch');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Instagram:' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Instagram profile' })).toHaveCount(0);
  await page.getByLabel('Instagram profile URL').fill('https://www.instagram.com/testranch?utm_source=private');
  await page.getByLabel('Facebook profile URL').fill('https://www.facebook.com/testranch');
  await page.getByLabel('X profile URL', { exact: true }).fill('https://x.com/testranch');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profile saved on this device' })).toBeVisible();
  await page.goto('/app/sales');
  await expect(page.getByRole('link', { name: 'Open Instagram profile' })).toHaveAttribute(
    'href',
    'https://www.instagram.com/testranch',
  );
  await expect(page.getByRole('link', { name: 'Open Instagram profile' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await page.getByRole('heading', { name: 'Ranch social profiles' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('ranch-social-mobile.png') });
  await page.reload();
  await expect(page.getByRole('link', { name: 'Open Instagram profile' })).toHaveAttribute(
    'href',
    'https://www.instagram.com/testranch',
  );
  await expect(page.getByRole('link', { name: 'Open X profile' })).toHaveAttribute('href', 'https://x.com/testranch');
  await page.getByRole('link', { name: 'Manage social links' }).click();
  await page.getByLabel('Instagram profile URL').fill('');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('link', { name: 'Open Instagram profile' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Profile saved on this device' })).toBeVisible();
  await page.goto('/app/sales');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Open Instagram profile' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open Facebook profile' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/app/documents?upload=1');
  await expect(page.getByRole('link', { name: 'Open myAQHA' })).toHaveAttribute('href', 'https://www.myaqha.com/');
  await expect(page.getByText('XBAR does not connect to or sync your AQHA account.', { exact: false })).toBeVisible();
});

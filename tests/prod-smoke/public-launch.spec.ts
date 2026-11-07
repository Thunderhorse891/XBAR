import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`public launch paths are truthful and usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/pricing');
    await expect(
      page.getByText('Review the billing options available to your workspace inside XBAR.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('rowheader', { name: 'Annual price (billed yearly)', exact: true })).toBeVisible();
    for (const amount of ['120', '290', '790', '1,990']) {
      await expect(page.getByText(`$${amount}/year, billed annually`, { exact: false })).toBeVisible();
    }
    await expect(page.getByText('Annual billing is not currently offered.', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('rowheader', { name: 'Annual price (2 months free)' })).toHaveCount(0);
    // Public pages share the homepage's native mobile Menu. Prove support
    // is reachable there rather than assuming the retired horizontal rail.
    if (width === 390) await page.locator('.landing-mobile-nav > summary').click();
    await expect(page.locator('header').getByRole('link', { name: 'Help & support', exact: true })).toBeInViewport();
    await expect(page.locator('header').getByRole('link', { name: 'Help & support', exact: true })).toHaveAttribute(
      'href',
      'mailto:xbarje@gmail.com',
    );
    if (width === 390) await page.locator('.landing-mobile-nav > summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/public-pricing-${width}.png`, animations: 'disabled' });

    await page.goto('/demo');
    await expect(page.getByText('No account is needed to view this tour.', { exact: false })).toBeVisible();
    await page.getByRole('link', { name: 'View the sample sale packet', exact: true }).click();
    await expect(page).toHaveURL(/\/samples\/sample-sale-packet\.html$/);
    await expect(page.getByText('Every name, number, and record below is fictional.', { exact: false })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/demo$/);
    await page.getByRole('link', { name: 'Create an account', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/login\?mode=signup$/);
    await expect(page.getByRole('heading', { name: 'Create Account', exact: true })).toBeVisible();

    await page.getByLabel('Email or User ID').fill('prospective@xbar.test');
    const legal = page.getByRole('navigation', { name: 'Legal and support' });
    for (const [name, path] of [
      ['Terms of Service', '/terms'],
      ['Privacy Policy', '/privacy'],
    ]) {
      const link = legal.getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', path);
      const popupPromise = page.waitForEvent('popup');
      await link.click();
      const popup = await popupPromise;
      await expect(popup.locator('main .callout')).toContainText('Operational baseline only.');
      await popup.close();
      await expect(page.getByLabel('Email or User ID')).toHaveValue('prospective@xbar.test');
      await expect(page).toHaveURL(/\/app\/login\?mode=signup$/);
    }
    await page.screenshot({ path: `test-results/public-signup-${width}.png`, fullPage: true });
    await expect(legal.getByRole('link', { name: 'Help & support' })).toHaveAttribute(
      'href',
      'mailto:Xbarje@gmail.com',
    );
  });
}

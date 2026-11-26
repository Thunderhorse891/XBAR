import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`public launch paths are truthful and usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/pricing');
    await expect(page.getByText(/Planned new subscriptions are monthly, in USD per workspace/)).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Paid upgrades are not available yet' })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: 'Annual price (billed yearly)', exact: true })).toHaveCount(0);
    const plans = page.locator('.plan');
    await expect(plans).toHaveCount(3);
    for (const [tier, expectedPrice] of [
      ['Free', '$0/month'],
      ['Professional', '$19.99/month'],
      ['Ranch Ops', '$49.99/month'],
    ]) {
      const card = plans.filter({ has: page.getByRole('heading', { name: tier, exact: true }) });
      await expect(card).toBeVisible();
      await expect(card.locator('.plan__price')).toHaveText(expectedPrice);
      await expect(card.getByRole('link', { name: 'Create an account', exact: true })).toHaveAttribute(
        'href',
        '/app/login?mode=signup',
      );
    }
    for (const tier of ['Starter', 'Enterprise']) {
      await expect(plans.getByRole('link', { name: `Choose ${tier}`, exact: true })).toHaveCount(0);
    }
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

    await page.goto('/demo');
    await expect(page.getByText('No account is needed to view this tour.', { exact: false })).toBeVisible();
    await page.locator('.hero').getByRole('link', { name: 'Open the sample packet', exact: true }).click();
    await expect(page).toHaveURL(/\/samples\/sample-sale-packet\.html$/);
    await expect(page.getByText('Every name, number, and record below is fictional.', { exact: false })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/demo$/);
    await page.locator('.cta').getByRole('link', { name: 'Start free', exact: true }).click();
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

    await expect(legal.getByRole('link', { name: 'Help & support' })).toHaveAttribute(
      'href',
      'mailto:Xbarje@gmail.com',
    );
  });
}

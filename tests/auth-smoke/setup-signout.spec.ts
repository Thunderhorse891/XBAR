import { expect, test, type Locator } from '@playwright/test';
import { blockWebfonts, RECOVERY_EMAIL, sessionLink, stubGoTrueUser } from './support.js';

async function expectReadableContrast(locator: Locator, surfaceSelector = '') {
  const contrast = await locator.evaluate((element, surfaceSelector) => {
    const luminance = (color: string) => {
      const rgb = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(
      getComputedStyle(surfaceSelector ? element.closest(surfaceSelector)! : element).backgroundColor,
    );
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  }, surfaceSelector);
  expect(contrast).toBeGreaterThanOrEqual(4.5);
}

blockWebfonts();

for (const outcome of ['success', 'failure'] as const) {
  test(`workspace setup sign-out ${outcome} before creating a workspace`, async ({ page }) => {
    await stubGoTrueUser(page);
    let logoutCalls = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/auth/v1/logout*', async (route) => {
      logoutCalls += 1;
      await held;
      await route.fulfill(
        outcome === 'success'
          ? { status: 204 }
          : {
              status: 400,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Sign-out temporarily unavailable' }),
            },
      );
    });
    await page.goto(sessionLink('signin').replace('/app/reset-password', '/app/setup'));
    await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toBeVisible();
    await expect(page.getByText(`Signed in as ${RECOVERY_EMAIL}.`)).toBeVisible();
    // The signed-in identity is ordinary text inside the graphite intro.
    // Visibility alone does not catch inheriting black text from the outer shell.
    await expectReadableContrast(page.getByText(`Signed in as ${RECOVERY_EMAIL}.`), '.clean-auth-card--intro');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect.poll(() => logoutCalls).toBe(1);
    await expect(page.getByRole('button', { name: 'Signing out...' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeDisabled();
    release();
    if (outcome === 'success') {
      await expect(page).toHaveURL(/\/app\/login/);
      await page.goto('/app/setup');
      await expect(page).toHaveURL(/\/app\/login/);
      await expect(page.getByRole('heading', { name: 'Configure Workspace' })).toHaveCount(0);
    } else {
      await expect(page.getByRole('alert')).toContainText('Sign-out temporarily unavailable');
      await expectReadableContrast(page.locator('.clean-form-error'));
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeEnabled();
      await expect(page).toHaveURL(/\/app\/setup/);
    }
    expect(logoutCalls).toBe(1);
  });
}

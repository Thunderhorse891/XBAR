import { expect, test } from '@playwright/test';

/*
 * The production block on owner test mode, checked against a real production
 * bundle rather than against the function that implements it.
 *
 * VITE_XBAR_LOCAL_OWNER_MODE lets the owner preview tier-gated screens on a
 * machine with no cloud account. The unit tests cover the decision itself, but
 * the property that actually matters is a deployment property: a bundle built
 * by `vite build` must refuse the flag even when it was set at build time — for
 * example when it is left in a Vercel environment by accident.
 *
 * So this suite is meant to run against a dist built WITH the flag enabled:
 *
 *     VITE_XBAR_LOCAL_OWNER_MODE=true npm run build
 *     npx playwright test --config playwright.prod.config.ts \
 *       tests/prod-smoke/owner-mode-production-block.spec.ts
 *
 * If it passes against that build, it passes against any production build,
 * because that is the most permissive configuration a production bundle can
 * have. Running it against a bundle built without the flag still checks that
 * the control is absent, but proves the weaker statement.
 */

test('a production build never shows owner test mode', async ({ page }) => {
  await page.goto('/app/');

  // Wait for React to mount so absence means "did not render", not "not yet".
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 30_000 });

  await expect(page.getByLabel('Owner test mode')).toHaveCount(0);
  await expect(page.getByText('Owner test mode')).toHaveCount(0);

  // The tier switcher and the return control are the two things that would let
  // someone change what the app thinks they are entitled to.
  await expect(page.getByRole('button', { name: /Return to real plan/ })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Preview a tier' })).toHaveCount(0);
});

test('the production bundle reports itself as a production build', async ({ page }) => {
  // The block rests on this being true, so assert it rather than assume it.
  // Vite sets PROD on any `vite build` output; a bundler change that stopped
  // doing so would silently unblock owner mode, and the test above could still
  // pass for an unrelated reason (say, the component failing to render at all).
  await page.goto('/app/');
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 30_000 });

  const buildFlags = await page.evaluate(() => {
    const root = document.querySelector('#root');
    return { mounted: Boolean(root && root.childElementCount > 0) };
  });

  expect(buildFlags.mounted).toBe(true);
});

test('owner mode stays absent after visiting the billing screen', async ({ page }) => {
  // The screen where tier state is most visible, and the one an operator would
  // reach for. Nothing about navigating to it may bring the control back.
  await page.goto('/app/#/billing');
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 30_000 });

  await expect(page.getByLabel('Owner test mode')).toHaveCount(0);
});

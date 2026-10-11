import { expect, test } from '@playwright/test';
import { blockWebfonts, RECOVERY_EMAIL, refreshedSession, sessionLink, stubGoTrueUser } from './support.js';

blockWebfonts();

for (const arrival of ['immediate signup', 'confirmation return'] as const) {
  for (const failure of ['getter', 'read', 'write'] as const) {
    test(`${arrival} reaches setup when session storage fails at ${failure}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((mode) => {
        if (mode === 'getter') {
          Object.defineProperty(window, 'sessionStorage', {
            configurable: true,
            get() {
              throw new DOMException('Site data blocked', 'SecurityError');
            },
          });
        } else {
          const session = window.sessionStorage;
          const method = mode === 'read' ? 'getItem' : 'setItem';
          const original = Storage.prototype[method];
          Object.defineProperty(Storage.prototype, method, {
            configurable: true,
            value(this: Storage, ...args: string[]) {
              if (this === session) throw new DOMException('Session storage blocked', 'SecurityError');
              return Reflect.apply(original, this, args);
            },
          });
        }
      }, failure);
      await stubGoTrueUser(page);
      let welcomes = 0;
      await page.route('**/api/account/send-welcome', async (route) => {
        welcomes += 1;
        await route.fulfill({ status: 200, json: { ok: true } });
      });
      const login = '/app/login?mode=signup&plan=Professional';
      if (arrival === 'immediate signup') {
        await page.route('**/auth/v1/signup*', (route) => route.fulfill({ json: refreshedSession() }));
        await page.goto(login);
        await page.getByLabel('Email or User ID').fill(RECOVERY_EMAIL);
        await page.getByLabel('Password', { exact: true }).fill('synthetic-new-password');
        await page.getByRole('button', { name: 'Create Account', exact: true }).click();
      } else {
        await page.goto(sessionLink('signin').replace('/app/reset-password', login));
      }
      await expect(page).toHaveURL(/\/app\/setup\?plan=Professional$/);
      await expect(page.getByRole('heading', { name: 'Configure Workspace', exact: true })).toBeVisible();
      await expect.poll(() => welcomes).toBeGreaterThan(0);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Configure Workspace', exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

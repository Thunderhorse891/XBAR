import { expect, test } from '@playwright/test';

for (const withoutLocks of [false, true]) {
  test(`a stale tab preserves completed files from a second tab${withoutLocks ? ' without Web Locks' : ''}`, async ({
    context,
    page,
  }) => {
    if (withoutLocks) {
      await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
    }
    // Use a same-origin static document so application startup does not perform
    // unrelated hydration; both tabs import the actual production vault module.
    await page.goto('/robots.txt');
    const newerTab = await context.newPage();
    await newerTab.goto('/robots.txt');
    const keys = await newerTab.evaluate(async () => {
      const modulePath = '/src/lib/localFileVault.ts';
      const vault = await import(/* @vite-ignore */ modulePath);
      return vault.withVaultWriteGuard(async () => {
        const keys: string[] = [];
        for (const name of ['document.pdf', 'receipt.pdf', 'packet.html']) {
          keys.push(await vault.storeLocalFile(new Blob([name]), name, undefined, 'ranch-a'));
        }
        return keys;
      });
    });
    const reconciliation = await page.evaluate(async () => {
      const modulePath = '/src/lib/localFileVault.ts';
      const vault = await import(/* @vite-ignore */ modulePath);
      return { writing: vault.isVaultWriteInFlight(), deleted: await vault.sweepLocalFileVault([], 'ranch-a') };
    });
    expect(reconciliation).toEqual({ writing: false, deleted: 0 });
    const retained = await newerTab.evaluate(async (keys: string[]) => {
      const modulePath = '/src/lib/localFileVault.ts';
      const vault = await import(/* @vite-ignore */ modulePath);
      return Promise.all(
        keys.map(async (key) => {
          const file = await vault.readLocalFile(key);
          return file ? { owner: file.workspaceId, name: file.name, bytes: await file.blob.text() } : null;
        }),
      );
    }, keys);
    expect(retained).toEqual(
      ['document.pdf', 'receipt.pdf', 'packet.html'].map((name) => ({ owner: 'ranch-a', name, bytes: name })),
    );
  });
}

import { expect, test, type Locator, type Page } from '@playwright/test';

test.describe.configure({ retries: 0 });

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  for (const [placeholder, value] of [
    ['XBAR LLC', 'Cedar Ridge'],
    ['Primary Ranch', 'Cedar Ridge Ranch'],
    ['Ranch manager', 'Example Manager'],
    ['ops@yourranch.com', 'preview@example.test'],
    ['Legal owner', 'Cedar Ridge'],
    ['Owner entity', 'Cedar Ridge'],
    ['Barn A', 'Main Barn'],
    ['Pasture 1', 'North Pasture'],
  ])
    await page.getByPlaceholder(placeholder).fill(value);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.', exact: true })).toBeVisible();
  for (const close of await page.getByRole('button', { name: 'Close toast', exact: true }).all()) {
    await close.focus();
    await page.keyboard.press('Enter');
  }
}

async function doubleText(drawer: Locator) {
  // Synthetic text-only enlargement, not browser zoom, native Dynamic Type or hardware evidence.
  // Snapshot every original computed size before applying any change, avoiding inherited compounding.
  return drawer.evaluate((root) => {
    const sizes = [root, ...root.querySelectorAll<HTMLElement>('*')].map((node) => {
      const style = getComputedStyle(node);
      return { node: node as HTMLElement, font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
    });
    for (const { node, font, line } of sizes) {
      node.style.setProperty('font-size', `${font * 2}px`, 'important');
      if (Number.isFinite(line)) node.style.setProperty('line-height', `${line * 2}px`, 'important');
    }
    const button = root.querySelector('.xs-drawer__foot button')!;
    return {
      original: sizes.find((item) => item.node === button)!.font,
      enlarged: parseFloat(getComputedStyle(button).fontSize),
    };
  });
}

async function footerFits(drawer: Locator) {
  const footer = drawer.locator('.xs-drawer__foot');
  expect(await footer.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
    await footer.evaluate((node) => node.clientWidth),
  );
  expect(await drawer.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
    await drawer.evaluate((node) => node.clientWidth),
  );
  const content = await footer.evaluate((node) => {
    const rect = node.getBoundingClientRect(),
      style = getComputedStyle(node);
    return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) };
  });
  for (const button of await footer.getByRole('button').all()) {
    const rect = (await button.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(content.left - 1);
    expect(rect.x + rect.width).toBeLessThanOrEqual(content.right + 1);
    expect(await button.evaluate((node) => node.scrollHeight)).toBeLessThanOrEqual(
      await button.evaluate((node) => node.clientHeight),
    );
  }
}

for (const width of [320, 390, 1440]) {
  test(`first horse stays usable with 200 percent text and keyboard at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page);
    const opener = page.getByRole('button', { name: 'Create', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Add Horse', exact: true }).focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Add Horse', exact: true });
    await expect(drawer).toBeVisible();
    const scale = await doubleText(drawer);
    expect(scale.enlarged).toBeCloseTo(scale.original * 2, 1);
    await page.screenshot({ path: info.outputPath(`workspace-drawer-text-${width}.png`) });
    await footerFits(drawer);
    const name = drawer.getByRole('textbox', { name: 'Name', exact: true });
    const cancel = drawer.getByRole('button', { name: 'Cancel', exact: true });
    const add = drawer.getByRole('button', { name: 'Add Horse', exact: true });
    await drawer.getByRole('button', { name: 'Close', exact: true }).focus();
    for (const field of [
      name,
      drawer.getByRole('combobox', { name: 'Segment', exact: true }),
      drawer.getByRole('combobox', { name: 'Sex', exact: true }),
      drawer.getByRole('textbox', { name: /^Owner/ }),
      drawer.getByRole('textbox', { name: 'Location', exact: true }),
      cancel,
      add,
    ]) {
      await page.keyboard.press('Tab');
      await expect(field).toBeFocused();
      await expect(field).toBeInViewport();
    }
    await page.keyboard.press('Enter');
    await expect(drawer.getByRole('alert')).toHaveText('Enter a name to add the horse.');
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: info.outputPath(`workspace-drawer-error-${width}.png`) });
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+Tab');
    await expect(name).toBeFocused();
    await page.keyboard.type('Copper Canyon');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(drawer).toHaveCount(0);
    await expect(page.locator('.xs-objhead__name')).toHaveText(/copper canyon/i);
    // Keyboard-only reopen/cancel keeps the existing record and restores its opener.
    await opener.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Add Horse', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.locator('.xs-objhead__name')).toHaveText(/copper canyon/i);
  });
}

for (const context of ['empty horse action', 'pasture details', 'task details']) {
  test(`shared drawer footer reflows at 200 percent text: ${context}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page);
    const create = page.getByRole('button', { name: 'Create', exact: true });
    let opener: Locator;
    if (context === 'empty horse action') {
      opener = create;
      await create.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Move Horse', exact: true }).focus();
      await page.keyboard.press('Enter');
    } else if (context === 'pasture details') {
      await page.goto('/app/pastures');
      opener = page.getByRole('button', { name: /^Main Barn/ });
      await opener.focus();
      await page.keyboard.press('Enter');
    } else {
      await create.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Add Horse', exact: true }).focus();
      await page.keyboard.press('Enter');
      const form = page.getByRole('dialog', { name: 'Add Horse', exact: true });
      await form.getByRole('textbox', { name: 'Name', exact: true }).focus();
      await page.keyboard.type('Copper Canyon');
      await form.getByRole('button', { name: 'Add Horse', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(form).toHaveCount(0);
      await expect(page.locator('.xs-objhead__name')).toHaveText(/copper canyon/i);
      await page.goto('/app/today');
      opener = page.getByRole('button', { name: /^Open task:/ }).first();
      await opener.focus();
      await page.keyboard.press('Enter');
    }
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    const scale = await doubleText(drawer);
    expect(scale.enlarged).toBeCloseTo(scale.original * 2, 1);
    await footerFits(drawer);
    await page.screenshot({ path: info.outputPath(`workspace-shared-drawer-${context.replaceAll(' ', '-')}.png`) });
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}

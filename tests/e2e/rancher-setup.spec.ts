import { expect, test, type Page } from '@playwright/test';

async function startRanch(page: Page) {
  await page.addInitScript(() => localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await expect(page.getByRole('heading', { name: 'Set up your ranch' })).toBeVisible();
  await expect(page.locator('form input')).toHaveCount(1);
  await page.getByLabel('Ranch name').fill('Canyon Ranch');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('form input')).toHaveCount(1);
  await page.getByLabel('Horse name', { exact: true }).fill('Blue');
  await page.getByRole('button', { name: 'Open my ranch', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Blue has a place in your ranch.' })).toBeVisible();
}

async function savedHorse(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    const state = useXbarStore.getState();
    return { horses: state.horses, ownership: state.ownershipRecords, profile: state.workspaceProfile };
  });
}

test('two names create one honest horse record and a next step, preserved after reload and retry', async ({ page }) => {
  await startRanch(page);
  const before = await savedHorse(page);
  expect(before.horses).toHaveLength(1);
  expect(before.horses[0]).toMatchObject({
    name: 'BLUE',
    barnName: 'Blue',
    sex: 'Not recorded',
    segment: 'Unassigned',
    status: 'New record',
    owner: '',
    ownerEntity: '',
    ownership: [],
    registered: false,
    registrationNumber: '',
    foaledOn: '',
    bloodline: { sire: '', dam: '' },
    location: { barn: '', pasture: '' },
  });
  expect(before.ownership[0]).toMatchObject({ legalOwner: '', complianceDeadline: '' });
  await page.getByRole('button', { name: 'Add this horse’s papers' }).click();
  const drawer = page.getByRole('dialog', { name: 'Upload Document' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel('Link to horse (optional)')).toHaveValue(before.horses[0].id);
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  // Repeating creation after a cloud-save failure must preserve the first ID.
  await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    const state = useXbarStore.getState();
    state.initializeWorkspace(state.workspaceProfile, 'Different retry name');
  });
  expect((await savedHorse(page)).horses).toEqual(before.horses);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Blue has a place in your ranch.' })).toBeVisible();
  expect((await savedHorse(page)).horses).toEqual(before.horses);
  // Returning to setup must not overwrite a configured ranch or add horses.
  await page.goto('/app/setup');
  await expect(page).toHaveURL(/\/app$/);
  expect((await savedHorse(page)).horses).toEqual(before.horses);
});

test('mobile field actions are reachable from home with large controls at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await startRanch(page);
  const actions = page.getByRole('navigation', { name: 'Quick ranch actions' });
  await expect(actions.getByRole('button')).toHaveCount(5);
  for (const [label, title] of [
    ['Log care', 'Add Health Record'],
    ['Add papers', 'Upload Document'],
    ['Move a horse', 'Move Horse'],
    ['Log expense', 'Add Expense'],
  ]) {
    await actions.getByRole('button', { name: label, exact: true }).click();
    const drawer = page.getByRole('dialog', { name: title, exact: true });
    await expect(drawer).toBeVisible();
    const sizes = await drawer
      .locator('.xs-btn, .xs-iconbtn, .xs-input, .xs-select, .xs-textarea')
      .evaluateAll((elements) =>
        elements
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => ({
            height: el.getBoundingClientRect().height,
            font: parseFloat(getComputedStyle(el).fontSize),
            tag: el.tagName,
          })),
      );
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size.height).toBeGreaterThanOrEqual(48);
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(size.tag)) expect(size.font).toBeGreaterThanOrEqual(16);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await actions.getByRole('button', { name: 'Find a horse' }).click();
  await expect(page).toHaveURL(/\/app\/horses$/);
  await expect(page.getByText('BLUE', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('desktop keeps its existing navigation; medical staff only see permitted shortcuts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startRanch(page);
  await expect(page.getByRole('navigation', { name: 'Quick ranch actions' })).toBeHidden();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(async () => {
    const modulePath = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ modulePath);
    useXbarStore.getState().setCurrentRole('Medical Lead');
  });
  const actions = page.getByRole('navigation', { name: 'Quick ranch actions' });
  await expect(actions.getByRole('button')).toHaveCount(3);
  await expect(actions.getByRole('button', { name: 'Move a horse' })).toHaveCount(0);
  await expect(actions.getByRole('button', { name: 'Log expense' })).toHaveCount(0);
});

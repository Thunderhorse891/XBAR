import { expect, test } from '@playwright/test';

test('context-menu horse selection saves only that horse economics', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('xbar-command-center-entry', 'true'));
  await page.goto('/app/setup');
  await page.getByPlaceholder('XBAR LLC').fill('Synthetic Breeding Ranch');
  await page.getByPlaceholder('Primary Ranch').fill('Synthetic Breeding Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Test Manager');
  await page.getByPlaceholder('ops@yourranch.com').fill('breeding@example.test');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.evaluate(async () => {
    const storePath = '/src/store/useXbarStore.ts';
    const helpersPath = '/src/store/xbarStoreHelpers.ts';
    const runtimePath = '/src/lib/xbarRuntime.ts';
    const { useXbarStore } = await import(storePath);
    const { createHorseRecord } = await import(helpersPath);
    const { buildSubscriptionForTier } = await import(runtimePath);
    const state = useXbarStore.getState();
    const horse = (id: string, fee: number) => ({
      ...createHorseRecord(
        {
          name: id,
          barnName: '',
          segment: 'Stud',
          sex: 'Stallion',
          status: 'Pasture',
          owner: 'Test',
          ownerEntity: 'Test',
          barn: 'Main',
          pasture: '',
        },
        state.workspaceProfile,
      ),
      id,
      breedingEconomics: {
        studFee: fee,
        bookedMares: 2,
        breedingCosts: 30,
        mareProductionValue: 40,
        foalProjectedValue: 50,
      },
    });
    useXbarStore.setState({
      horses: [horse('First Stud', 100), horse('Second Stud', 900)],
      subscription: buildSubscriptionForTier(state.subscription, 'Enterprise'),
    });
    history.pushState({}, '', '/app/breeding');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByLabel('Stud fee', { exact: true })).toHaveValue('100');
  await page
    .locator('.stack-item')
    .filter({ has: page.getByText('Second Stud', { exact: true }) })
    .first()
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Log breeding event' }).click();
  await expect(page.getByLabel('Stud fee', { exact: true })).toHaveValue('900');
  await page.getByRole('button', { name: 'Save revenue model' }).click();
  const fees = await page.evaluate(async () => {
    const path = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(path);
    return useXbarStore
      .getState()
      .horses.map((h: { breedingEconomics: { studFee: number } }) => h.breedingEconomics.studFee);
  });
  expect(fees).toEqual([100, 900]);
});

import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
  await page.goto('/app/login');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByPlaceholder('XBAR LLC').fill('Fictional Creek Ranch');
  await page.getByPlaceholder('Primary Ranch').fill('Fictional Creek Ranch');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.waitForURL(/\/app$/);
}
async function nav(page: Page, target: string) {
  await page.evaluate((url) => {
    history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, target);
}
test('empty mobile Documents offers an actual first upload', async ({ page }) => {
  await setup(page);
  await nav(page, '/app/documents');
  const overview = page.getByRole('region', { name: 'Document overview' });
  await expect(overview.getByText('Not on file', { exact: true })).toHaveCount(3);
  await overview.getByRole('button', { name: 'Add the first document' }).click();
  await expect(page.getByRole('tab', { name: /^1\. Upload/ })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('horse file inventory follows real local records, async state and review permissions', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('Copper Creek Fictional');
  await drawer.getByLabel('Sex', { exact: true }).selectOption('Mare');
  await drawer.getByLabel('Segment', { exact: true }).selectOption('Sale Prospect');
  await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
  await page.waitForURL(/\/horses\//);
  await page.evaluate(async () => {
    const module = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ module);
    const state = useXbarStore.getState();
    const horse = state.horses[0];
    const common = {
      uploadedBy: 'Fictional staff',
      uploadedAt: new Date().toISOString(),
      source: 'Manual Upload',
      confidence: 0,
      duplicateRisk: 'Low',
      extractedTextPreview: '',
      summary: 'Fictional only',
      entities: {},
    };
    useXbarStore.setState({
      documents: [
        {
          ...common,
          id: 'reg',
          horseId: horse.id,
          title: 'Registration — fictional',
          type: 'Registration',
          state: 'Needs Review',
        },
        {
          ...common,
          id: 'health',
          horseId: horse.id,
          title: 'Health — fictional',
          type: 'Vet Record',
          state: 'Queued',
        },
        {
          ...common,
          id: 'other',
          horseId: 'another-horse',
          title: 'Other horse transfer',
          type: 'Transfer Packet',
          state: 'Ready',
        },
      ],
    });
  });
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const overview = page.getByRole('region', { name: 'Document overview' });
  await expect(overview.getByText('Needs review', { exact: true })).toBeVisible();
  await expect(overview.getByText('Reading file', { exact: true })).toBeVisible();
  await expect(overview.getByText('Not on file', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Other horse transfer', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Registration — fictional library actions' })).toContainText(
    'No original file attached',
  );
  await page.evaluate(async () => {
    const module = '/src/store/useXbarStore.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ module);
    const state = useXbarStore.getState();
    useXbarStore.setState({
      documents: state.documents.filter((doc: { id: string }) => doc.id !== 'health'),
      currentRole: 'Ranch Manager',
    });
  });
  await expect(overview.getByText('Not on file', { exact: true })).toHaveCount(2);
  await expect(overview.getByRole('button', { name: /^Review/ })).toHaveCount(0);
  await expect(
    page
      .getByRole('group', { name: 'Registration — fictional library actions' })
      .getByRole('button', { name: 'Review', exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

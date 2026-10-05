import { expect, test, type Page } from '@playwright/test';

async function bootstrapWorkspace(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));

  // The application router lives under /app (marketing owns the site root).
  await page.goto('/app/setup');

  const setupHeading = page.getByRole('heading', { name: 'Configure Workspace' });
  const setupVisible = await setupHeading.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!setupVisible) {
    await page.goto('/app/setup');
  }
  await expect(setupHeading).toBeVisible({ timeout: 10_000 });

  // Fill by placeholder — stable against label theming.
  await page.getByPlaceholder('XBAR LLC').fill('XBAR Holdings');
  await page.getByPlaceholder('Primary Ranch').fill('Thunder Horse Ranch');
  await page.getByPlaceholder('Ranch manager').fill('Erin Wyrick');
  await page.getByPlaceholder('ops@yourranch.com').fill('ops@xbar.test');
  await page.getByPlaceholder('Legal owner').fill('Thunder Horse Ranch');
  await page.getByPlaceholder('Owner entity').fill('Thunder Horse Ranch LLC');
  await page.getByPlaceholder('Barn A').fill('Barn A');
  await page.getByPlaceholder('Pasture 1').fill('North Pasture');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });
  // Fresh workspace lands on the plain-language getting-started dashboard (no seeded records).
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible({
    timeout: 15_000,
  });
}

// Seed one real horse through the global Create > Add Horse flow (persists to the store).
async function seedHorse(page: Page, name = 'Test Prospect') {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill(name);
  await drawer.getByLabel('Sex', { exact: true }).selectOption('Mare');
  await drawer.getByLabel('Segment', { exact: true }).selectOption('Broodmare');
  await drawer.getByRole('button', { name: 'Add Horse' }).click();
  await expect(page).toHaveURL(/\/horses\//, { timeout: 15_000 });
}

test('entry, overview and reload share chronological breeding outcomes', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Chronology Mare');
  await page.goto('/app/breeding');
  await page.getByRole('combobox', { name: 'Horse', exact: true }).selectOption({ label: 'Chronology Mare' });
  const save = async (kind: string, result: string, date: string, title: string) => {
    await page.getByRole('combobox', { name: 'Entry type', exact: true }).selectOption(kind);
    await page
      .getByRole('combobox', { name: kind === 'foaling' ? 'Foaling outcome' : 'Check result', exact: true })
      .selectOption(result);
    await page.getByLabel('Event date', { exact: true }).fill(date);
    await page.getByLabel('Milestone', { exact: true }).fill(title);
    await page.getByLabel('Breeding note', { exact: true }).fill('Synthetic chronological outcome test.');
    await page.getByRole('button', { name: 'Save breeding event', exact: true }).click();
    await expect(page.getByLabel('Breeding note', { exact: true })).toHaveValue('');
  };
  await save('pregnancy-check', 'in-foal', '2026-06-01', 'Confirmed pregnancy');
  await expect(page.getByText('Confirmed in foal', { exact: true })).toBeVisible();
  await save('foaling', 'live', '2026-07-01', 'Foaled live');
  await save('pregnancy-check', 'in-foal', '2026-06-15', 'Backfilled old positive');
  await page.goto('/app/breeding-foaling');
  const row = page.getByRole('row').filter({ hasText: 'Chronology Mare' });
  await expect(row).toContainText('Foaled — live');
  await expect(row).toContainText('Foaled live');
  await expect(row).not.toContainText('Backfilled old positive');
  await page.reload();
  await expect(row).toContainText('Foaled — live');
  await page.getByRole('button', { name: 'Open breeding records', exact: true }).click();
  await expect(page.getByText('Foaled — live', { exact: true })).toBeVisible();
});

test('foaling requires an outcome and displays explicit unknown honestly', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Unknown Outcome Mare');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Breeding Record', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Breeding Record' });
  await drawer.getByRole('combobox', { name: 'Entry type', exact: true }).selectOption('foaling');
  await drawer.getByLabel('Title', { exact: true }).fill('Foaling recorded');
  await drawer.getByLabel('Notes', { exact: true }).fill('Outcome remains unconfirmed.');
  await drawer.getByRole('button', { name: 'Save Breeding Record', exact: true }).click();
  await expect(page.getByText(/Choose the foaling outcome/)).toBeVisible();
  await drawer.getByRole('combobox', { name: 'Foaling outcome', exact: true }).selectOption('unknown');
  await drawer.getByRole('button', { name: 'Save Breeding Record', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.goto('/app/breeding-foaling');
  await expect(page.getByRole('row').filter({ hasText: 'Unknown Outcome Mare' })).toContainText(
    'Foaling recorded — outcome unconfirmed',
  );
});

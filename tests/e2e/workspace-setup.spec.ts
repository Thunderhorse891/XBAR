import { expect, test } from '@playwright/test';
import { bootstrapWorkspace, seedHorse } from './helpers.js';

test('creates a workspace and lands on the getting-started dashboard', async ({ page }) => {
  await bootstrapWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Get your horse records in order.' })).toBeVisible();
  await expect(page.locator('.xs-ribbon')).toBeVisible();
  await expect(page.getByText('Smart Help')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add your first horse' })).toBeVisible();
});

test('global Create opens a real create drawer with fields', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Horse' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add Horse' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Name', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Add Horse' })).toBeVisible();
});

test('a seeded horse produces care tasks and a task drawer', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Task Horse');
  await page.getByRole('link', { name: 'Care Tasks', exact: true }).click();
  await page.locator('.xs-task').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Open linked record' })).toBeVisible();
});

test('horses roster shows an empty state until a horse is added', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Horses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Build your first sale-ready horse record.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Horse', exact: true })).toBeVisible();
});

test('sale packets opens the real packet generator once a horse exists', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Packet Horse');
  await page.getByRole('link', { name: 'Sale Packets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sale Packets' })).toBeVisible();
  await expect(page.getByText('Horse readiness')).toBeVisible();
  await page
    .locator('.xs-mrow')
    .filter({ hasText: /packet horse/i })
    .getByRole('button', { name: 'Build packet' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Sale packet generator' })).toBeVisible();
  await expect(page.getByText('is selected for release-gate review')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByText('Release gate: this packet cannot be issued until title & transfer is provable.'),
  ).toBeVisible();
});

test('buyer follow-up shows an empty state on a fresh workspace', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Buyer follow-up', exact: true }).click();
  await expect(page.getByText('No buyers yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare Sale Packet' })).toBeVisible();
});

test('documents shows an empty state on a fresh workspace', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await expect(page.getByText('Review queue is clear')).toBeVisible();
});

test('pasture location opens a detail drawer', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Pastures', exact: true }).click();
  await page.locator('.xs-grid-2 .xs-card').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Horses currently here')).toBeVisible();
});

test('a seeded horse opens a full profile object page with tabs', async ({ page }) => {
  await bootstrapWorkspace(page);
  await seedHorse(page, 'Roster Prospect');
  await page.getByRole('link', { name: 'Horses', exact: true }).click();
  await page.getByRole('link', { name: 'Horse record' }).click();
  await expect(page).toHaveURL(/\/horses\//);
  await expect(page.locator('.xs-objhead__name')).toHaveText(/roster prospect/i);
  await page.getByRole('button', { name: 'Documents' }).click();
  await expect(page.getByText('No documents linked to this horse yet.')).toBeVisible();
});

test('sales renders the buyer follow-up sales surface', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('link', { name: 'Sales', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sales & Transfers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Buyer follow-up' })).toBeVisible();
});

test('billing page shows tier cards', async ({ page }) => {
  await bootstrapWorkspace(page);
  await page.getByRole('button', { name: 'Billing' }).click();
  await expect(page.getByRole('heading', { name: 'Review Billing' })).toBeVisible();
  await expect(page.locator('.checkout-plan')).toHaveCount(4);
});

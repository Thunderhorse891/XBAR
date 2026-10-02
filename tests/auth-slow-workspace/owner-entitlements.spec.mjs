/* global indexedDB, history, dispatchEvent, PopStateEvent */
import { expect, test } from '@playwright/test';
// Playwright resolves the app's Vite aliases. Keep this browser-only fixture
// outside the separate NodeNext unit-test compilation.
import {
  createEmptyWorkspaceState,
  createHorseRecord,
  WORKSPACE_SCHEMA_VERSION,
} from '../../src/store/xbarStoreHelpers.js';
import { blockWebfonts, sessionLink, stubGoTrueUser } from '../auth-smoke/support.js';

blockWebfonts();

const workspaceId = '7f1d0c44-0000-4000-8000-0000000000ee';
function ranch() {
  const state = structuredClone(createEmptyWorkspaceState());
  Object.assign(state.workspaceProfile, {
    setupCompleteAt: '2026-09-10T12:00:00Z',
    ranchName: 'Owner entitlement ranch',
    businessName: 'Fixture',
    defaultOwnerName: 'Owner',
    defaultOwnerEntity: 'Ranch',
    defaultBarn: 'Main barn',
    defaultPasture: 'North pasture',
  });
  state.horses = Array.from({ length: 5 }, (_, i) =>
    createHorseRecord(
      {
        name: `Preserved horse ${i + 1}`,
        barnName: `Horse ${i + 1}`,
        owner: 'Owner',
        ownerEntity: 'Ranch',
        barn: 'Main barn',
        pasture: 'North pasture',
        sex: 'Mare',
        segment: 'Broodmare',
        status: 'Pasture',
      },
      state.workspaceProfile,
    ),
  );
  return state;
}

async function readRanch(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('xbar-workspace', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const read = db.transaction('persist', 'readonly').objectStore('persist').get('xbar-live-workspace');
        read.onsuccess = () => resolve(JSON.parse(read.result ?? '{}').state ?? {});
        read.onerror = () => reject(read.error);
      });
    } finally {
      db.close();
    }
  });
}

for (const conflict of [false, true]) {
  test(`canonical owner grant restores reports and sixth-horse entry ${conflict ? 'without overwriting local conflicts' : 'from a Starter cloud snapshot'}`, async ({
    page,
  }) => {
    const remote = ranch();
    const local = structuredClone(remote);
    if (conflict) {
      local.horses[0].notes.push({
        id: 'local-only-note',
        body: 'Keep this unsynced note',
        title: 'Unsynced owner note',
        createdAt: '2026-10-01T00:00:00Z',
        tone: 'info',
        author: 'Owner',
      });
      // Seed at the same schema version to exercise the actual current store.
      await page.addInitScript(
        ({ state, version }) => {
          if (!localStorage.getItem('owner-entitlement-fixture-seeded')) {
            localStorage.setItem('xbar-live-workspace', JSON.stringify({ state, version }));
            localStorage.setItem('owner-entitlement-fixture-seeded', 'true');
          }
        },
        { state: local, version: WORKSPACE_SCHEMA_VERSION },
      );
    }
    let cloudWrites = 0;
    await stubGoTrueUser(page);
    await page.route('**/rest/v1/**', async (route) => {
      const request = route.request();
      const table = new URL(request.url()).pathname.split('/').pop();
      if (request.method() !== 'GET') {
        cloudWrites += 1;
        return route.fulfill({ status: 200, json: [] });
      }
      if (table === 'workspaces') return route.fulfill({ status: 200, json: { id: workspaceId } });
      if (table === 'workspace_subscription_profiles')
        return route.fulfill({
          status: 200,
          json: { tier: 'Enterprise', billing_state: 'Manual Billing', monthly_rate: 0, payload: {} },
        });
      if (table === 'workspace_snapshots')
        return route.fulfill({
          status: 200,
          json: {
            payload: { app: 'XBAR', version: WORKSPACE_SCHEMA_VERSION, workspace: remote },
            updated_at: '2026-10-02T00:00:00Z',
          },
        });
      // One failed relational read must fall back to the records snapshot while
      // still reading the authoritative subscription independently.
      return route.fulfill({ status: 503, json: { message: 'Relational fixture unavailable' } });
    });
    await page.goto(sessionLink('signin'));
    await expect(page.getByText(/This page needs a current password-reset link/)).toBeVisible();
    await page.evaluate(() => {
      history.pushState({}, '', '/app/reports');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('button', { name: 'Download PDF report' })).toBeVisible({ timeout: 20_000 });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export spreadsheet' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    await expect.poll(async () => (await readRanch(page)).subscription?.tier).toBe('Enterprise');
    const saved = await readRanch(page);
    expect(saved.horses).toEqual(conflict ? local.horses : remote.horses);
    expect(saved.subscription.monthlyRate).toBe(0);
    if (conflict) expect(cloudWrites, 'conflicting local work must never be automatically pushed').toBe(0);
    await page.goto('/app/horses?new=1');
    await expect(page.getByRole('heading', { name: 'Add a horse', exact: true })).toBeVisible();
    await expect(page.getByLabel('Registered name', { exact: true })).toBeEnabled();
    await page.getByLabel('Registered name', { exact: true }).fill('Sixth preserved horse');
    await page.getByLabel('Barn name', { exact: true }).fill('Sixth');
    await expect(page.getByRole('button', { name: 'Create horse record', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Create horse record', exact: true }).click();
    await expect.poll(async () => (await readRanch(page)).horses?.length).toBe(6);
    await expect.poll(async () => (await readRanch(page)).subscription?.tier).toBe('Enterprise');
  });
}

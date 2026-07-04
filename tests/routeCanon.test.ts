import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { canonicalRoutes, legacyRouteRedirects } from '../src/lib/routeCanon.js';

const canonicalSet = new Set(Object.values(canonicalRoutes));
const repoRoot = process.cwd();

function readRepoFile(filePath: string) {
  return readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function userFacingSource(filePath: string) {
  return readRepoFile(filePath).replace(/state\.initializeWorkspace/g, 'state.setUpWorkspace');
}

test('every legacy route redirects to a canonical product route', () => {
  for (const [from, to] of Object.entries(legacyRouteRedirects)) {
    assert.ok(canonicalSet.has(to as (typeof canonicalRoutes)[keyof typeof canonicalRoutes]), `${from} must redirect to a canonical route, got ${to}`);
    assert.ok(!canonicalSet.has(from as never), `${from} is legacy and must not also be canonical`);
  }
});

test('all known legacy paths stay in the redirect map so they never return as live routes', () => {
  const requiredLegacy = [
    '/animals',
    '/documents-vault',
    '/document-library',
    '/sales-pipeline',
    '/buyer-deal-room',
    '/buyer-follow-up',
    '/sale-packet-studio',
    '/plans',
    '/subscribe',
    '/subscriptions',
  ];
  for (const path of requiredLegacy) {
    assert.ok(legacyRouteRedirects[path], `missing redirect for legacy path ${path}`);
  }
});

test('canonical routes are one per product area', () => {
  assert.equal(canonicalRoutes.horses, '/horses');
  assert.equal(canonicalRoutes.documents, '/documents');
  assert.equal(canonicalRoutes.sales, '/sales');
  assert.equal(canonicalRoutes.buyers, '/buyers');
  assert.equal(canonicalRoutes.salePackets, '/sale-packets');
  assert.equal(canonicalRoutes.billing, '/billing');
  assert.equal(canonicalRoutes.settings, '/settings');
});

test('active user-facing surfaces use plain product language', () => {
  const activeFiles = [
    'src/components/BuyerDealRoomPanel.tsx',
    'src/components/SalePacketWizard.tsx',
    'src/components/saas/flows.tsx',
    'src/lib/buyerDealRoom.ts',
    'src/lib/commercialEngine.ts',
    'src/lib/documentTemplateLibrary.ts',
    'src/lib/operationalValuePulse.ts',
    'src/lib/revenuePlanMatrix.ts',
    'src/lib/todayWork.ts',
    'src/lib/xbarGrowth.ts',
    'src/lib/xbarPhaseTwo.ts',
    'src/lib/xbarRuntime.ts',
    'src/pages/Dashboard.tsx',
    'src/routes/AnimalProfile.tsx',
    'src/routes/Breeding.tsx',
    'src/routes/BuyerDealRoom.tsx',
    'src/routes/Documents.tsx',
    'src/routes/Expenses.tsx',
    'src/routes/GettingStarted.tsx',
    'src/routes/HealthCare.tsx',
    'src/routes/Horses.tsx',
    'src/routes/Landing.tsx',
    'src/routes/Login.tsx',
    'src/routes/OwnershipChain.tsx',
    'src/routes/Pastures.tsx',
    'src/routes/Reminders.tsx',
    'src/routes/Reports.tsx',
    'src/routes/Sales.tsx',
    'src/routes/SharedAccess.tsx',
    'src/routes/TodayWork.tsx',
    'src/routes/layouts/MainLayout.tsx',
  ];
  const forbiddenLanguage = /\b(?:Animals|Paperwork|paperwork|Vault|buyer room|Buyer room|buyer folder|Buyer folder|Deal Room|sale documents|Sale documents|Command Center|operator|Global Asset|Initialize|initialize)\b/;

  for (const filePath of activeFiles) {
    assert.doesNotMatch(userFacingSource(filePath), forbiddenLanguage, `${filePath} should use Horses, Documents, Buyer follow-up, and Sale Packets language`);
  }
});

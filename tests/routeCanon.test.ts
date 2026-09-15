import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  browserAuthFailureSearch,
  canonicalRoutes,
  hashAuthFailureRoute,
  legacyRouteRedirects,
  loginPath,
} from '../src/lib/routeCanon.js';

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
    assert.ok(
      canonicalSet.has(to as (typeof canonicalRoutes)[keyof typeof canonicalRoutes]),
      `${from} must redirect to a canonical route, got ${to}`,
    );
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
  const forbiddenLanguage =
    /\b(?:Animals|Paperwork|paperwork|Vault|buyer room|Buyer room|buyer folder|Buyer folder|Deal Room|sale documents|Sale documents|Command Center|operator|Global Asset|Initialize|initialize)\b/;

  for (const filePath of activeFiles) {
    assert.doesNotMatch(
      userFacingSource(filePath),
      forbiddenLanguage,
      `${filePath} should use Horses, Documents, Buyer follow-up, and Sale Packets language`,
    );
  }
});

test('a rejected auth callback under the hash router becomes a routable sign-in', () => {
  /*
   * auth-js leaves an `#error=...` fragment in place and emits nothing, so
   * nothing navigates -- and on a hash router that fragment is the route, so
   * the customer met the not-found screen at exactly the moment they needed to
   * be told what went wrong.
   *
   * Sign-in rather than the reset screen: the fragment carries no flow marker,
   * so a cancelled OAuth consent and a dead recovery link look identical here,
   * and answering the first three of four with password-reset instructions was
   * worse than saying nothing.
   */
  assert.equal(
    hashAuthFailureRoute('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid'),
    `#${loginPath}?authError=Email%20link%20is%20invalid`,
  );
  // The reason travels, whichever key carries it.
  assert.equal(hashAuthFailureRoute('#error_code=otp_expired'), `#${loginPath}?authError=otp_expired`);
  assert.equal(hashAuthFailureRoute('#error=access_denied'), `#${loginPath}?authError=access_denied`);
});

test('a successful auth callback keeps its fragment, so auth-js can read the token', () => {
  // Rewriting this would take the token away before auth-js sees it, turning a
  // working reset into a broken one.
  assert.equal(hashAuthFailureRoute('#access_token=abc&type=recovery'), '');
  // Even alongside an error param, a token present means auth-js still has
  // work to do here.
  assert.equal(hashAuthFailureRoute('#access_token=abc&error=whatever'), '');
});

test('ordinary hash routes and empty fragments are left alone', () => {
  assert.equal(hashAuthFailureRoute('#/horses'), '');
  assert.equal(hashAuthFailureRoute('#/reset-password'), '');
  assert.equal(hashAuthFailureRoute(''), '');
  assert.equal(hashAuthFailureRoute('#'), '');
  // A route that merely mentions the word is not an auth failure.
  assert.equal(hashAuthFailureRoute('#/errors'), '');
});

test('the browser router keeps the path and moves only the reason', () => {
  /*
   * Nothing is unreachable there -- but nothing reads the fragment either, so
   * a rejected OAuth consent or signup confirmation returned an ordinary
   * sign-in form with no hint that anything had failed. The PATH stays where
   * Supabase sent them, so a failed recovery link still lands on the reset
   * screen and keeps its own guidance.
   */
  assert.equal(
    browserAuthFailureSearch('#error=access_denied&error_description=Email+link+has+expired', ''),
    '?authError=Email+link+has+expired',
  );
  // Existing parameters survive.
  assert.equal(
    browserAuthFailureSearch('#error_code=otp_expired', '?mode=signup'),
    '?mode=signup&authError=otp_expired',
  );
  // A successful callback, an ordinary fragment and an empty one are left alone.
  assert.equal(browserAuthFailureSearch('#access_token=abc&type=recovery', ''), '');
  assert.equal(browserAuthFailureSearch('', ''), '');
  assert.equal(browserAuthFailureSearch('#section', ''), '');
  // And it does not stack on a reload that still carries one.
  assert.equal(browserAuthFailureSearch('#error=access_denied', '?authError=already'), '');
});

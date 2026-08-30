import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { billingPath, billingPathForTier, legacyBillingPaths } from '../src/lib/billingRoutes.js';

const repoRoot = process.cwd();

function readRepoFile(filePath: string) {
  return readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('billing route helper keeps one canonical billing destination', () => {
  assert.equal(billingPath, '/billing');
  assert.equal(billingPathForTier('Professional'), '/billing?plan=Professional');
  assert.deepEqual([...legacyBillingPaths], ['/plans', '/subscribe', '/subscriptions']);
});

test('billing screen does not imply payment when checkout is not configured', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');

  for (const forbidden of [
    'Free trial',
    'Start free trial',
    'Due today',
    'Card Protected',
    'Receipt Emailed',
    'Activating plan',
    'Plans apply to this workspace right away',
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} should not appear in billing UI`);
  }

  assert.match(source, /Billing is not configured yet, so plans cannot be purchased in the app\./);
  assert.match(source, /Your workspace and current plan were not changed\./);

  // "Manual billing required" pointed the customer at a route they cannot
  // take: with Stripe absent there is no in-app path, and manual billing is an
  // operator action recorded server-side, not something a buyer can request
  // from this screen.
  assert.equal(source.includes('Manual billing required'), false);
  assert.equal(source.includes('Contact support/manual billing required'), false);
});

test('billing tiers remain reachable before workspace setup', () => {
  const source = readRepoFile('src/App.tsx');
  const appShell = source.indexOf('path="/"');
  const setupGate = source.indexOf('<RequireWorkspaceSetup>', appShell);

  assert.ok(appShell >= 0, 'the authenticated app shell route must exist');
  assert.ok(setupGate > appShell, 'workspace setup should guard the operational routes inside the shell');
  assert.ok(source.indexOf('path="billing"', appShell) < setupGate, '/billing must show plan tiers before setup');
  assert.ok(source.indexOf('path="plans"', appShell) < setupGate, '/plans must redirect before setup');
  assert.ok(source.indexOf('path="subscriptions"', appShell) < setupGate, '/subscriptions must redirect before setup');
  assert.match(source, /<RequireWorkspaceSetup>\s*<Outlet \/>/, 'operational routes stay protected by setup');
});

test('upgrade links use canonical billing path instead of legacy billing routes', () => {
  const checkedFiles = [
    'src/components/RequireSubscriptionFeature.tsx',
    'src/components/SalePacketWizard.tsx',
    'src/components/UsageMeterPanel.tsx',
    'src/lib/activation.ts',
    'src/lib/subscriptionGates.ts',
    'src/routes/Breeding.tsx',
    'src/routes/Documents.tsx',
    'src/routes/Expenses.tsx',
    'src/routes/GettingStarted.tsx',
    'src/routes/Login.tsx',
    'src/routes/layouts/MainLayout.tsx',
  ];
  const legacyLiteral = /['"`]\/(?:plans|subscribe|subscriptions)(?:[?'"`]|$)/;

  for (const filePath of checkedFiles) {
    assert.equal(
      legacyLiteral.test(readRepoFile(filePath)),
      false,
      `${filePath} should route billing actions through /billing`,
    );
  }
});

test('only a missing managed identity may fall back to a payment link', async () => {
  const client = await readFile('src/lib/billingApi.ts', 'utf8');
  const screen = await readFile('src/routes/Subscriptions.tsx', 'utf8');

  /*
   * The payment link is a `mode: 'subscription'` checkout that never consults
   * the workspace's billing row. Following it after the endpoint refused
   * reinstated the duplicate-charge path the refusal exists to close.
   *
   * Blocking a LIST of refusal codes was not enough, which is why this is an
   * allowlist now: `fetch` rejecting or a malformed body yields an UNCODED
   * failure, and those are exactly the cases where the endpoint guard never
   * ran — so a workspace with a live subscription still reached the link.
   */
  assert.match(client, /code: payload\.code,/, 'the server refusal code must survive the client boundary');
  assert.match(
    client,
    /export function canUsePaymentLinkFallback\(code\?: string\): boolean \{\s*return code === NO_MANAGED_IDENTITY;/,
    'the fallback must be an allowlist of one, not a blocklist of known refusals',
  );
  assert.match(
    screen,
    /const fallback = canUsePaymentLinkFallback\(managed\.code\) \? getStripePaymentLink\(tier\) : '';/,
    'the screen must reach the payment link only for the no-identity case',
  );
});

test('a transport failure is not evidence that a second subscription is safe', async () => {
  const client = await readFile('src/lib/billingApi.ts', 'utf8');

  // `fetch` rejecting, or a response body that will not parse, lands in the
  // catch with no code. Under the old blocklist that fell through to the
  // payment link — the one case where the server never got to check the
  // billing row at all. A network error says nothing about whether the
  // customer already pays us.
  assert.doesNotMatch(client, /POLICY_REFUSAL_CODES/, 'the blocklist must be gone, not merely bypassed');
  assert.doesNotMatch(client, /isBillingPolicyRefusal/, 'the blocklist predicate must be gone');
});

test('a local-only workspace can still buy a plan', async () => {
  const client = await readFile('src/lib/billingApi.ts', 'utf8');

  // Without a workspace id and access token the endpoint cannot be called, so
  // no billing row can be found and none can be duplicated. That path is how a
  // workspace with no cloud session legitimately reaches Stripe, and it has to
  // stay open — which is exactly why it is CODED rather than left uncoded and
  // indistinguishable from a fetch that threw.
  // `[^}]` already matches a newline, so the `(?:[^}]|\n)` this replaced gave
  // the engine two ways to consume the same character — ambiguity a lazy
  // quantifier turns into exponential backtracking, which is what CodeQL
  // flagged. One unambiguous class does the same job in linear time.
  assert.match(
    client,
    /if \(!params\.workspaceId \|\| !params\.accessToken\) \{\s*return \{\s*ok: false,[^}]*?code: NO_MANAGED_IDENTITY,/,
    'the no-identity path must carry the one code that permits a fallback',
  );
});

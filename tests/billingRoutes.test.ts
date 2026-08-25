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

test('a policy refusal never falls back to an unguarded payment link', async () => {
  const client = await readFile('src/lib/billingApi.ts', 'utf8');
  const screen = await readFile('src/routes/Subscriptions.tsx', 'utf8');

  /*
   * The payment link is a `mode: 'subscription'` checkout that never consults
   * the workspace's billing row. Redirecting to it after the server refused
   * reinstated the duplicate-charge path the refusal exists to close — and
   * silently: the customer saw an ordinary Stripe page and paid.
   */
  assert.match(client, /code: payload\.code,/, 'the server refusal code must survive the client boundary');
  for (const code of [
    'subscription_active',
    'subscription_recoverable',
    'subscription_unverified',
    'billing_unavailable',
  ]) {
    assert.match(client, new RegExp(`'${code}'`), `${code} must be treated as a policy refusal`);
  }

  assert.match(
    screen,
    /const fallback = isBillingPolicyRefusal\(managed\.code\) \? '' : getStripePaymentLink\(tier\);/,
    'the screen must not offer the payment link after a policy refusal',
  );
});

test('an ordinary checkout failure still falls back', async () => {
  const client = await readFile('src/lib/billingApi.ts', 'utf8');

  // A local-only workspace has no cloud session, so `startManagedCheckout`
  // returns early with no code at all — and the payment link is how those
  // workspaces legitimately buy a plan. Scoping the block to server codes is
  // what keeps that path open.
  assert.match(
    client,
    /export function isBillingPolicyRefusal\(code\?: string\): boolean \{\s*return Boolean\(code && POLICY_REFUSAL_CODES\.has\(code\)\);/,
    'an absent code must not be treated as a refusal',
  );
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { billingPath, billingPathForTier, legacyBillingPaths } from '../src/lib/billingRoutes.js';
import { NO_MANAGED_IDENTITY, canUsePaymentLinkFallback, checkoutRouteFor } from '../src/lib/billingApi.js';

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

test('paid signup creates the cloud workspace before billing checkout', () => {
  const login = readRepoFile('src/routes/Login.tsx');
  const setup = readRepoFile('src/routes/SetupWorkspace.tsx');

  /*
   * A new Supabase auth user is not enough to sell a plan: checkout needs the
   * workspace id written by the first workspace save. Paid signups therefore
   * carry the selected tier through setup, and setup refuses to move on to
   * billing until the cloud workspace has been saved.
   */
  assert.match(login, /if \(authMode === 'signup'\) return workspaceSetupPath;/);
  assert.match(login, /setupParams\.set\('plan', selectedPlan\)/);
  /*
   * Matched loosely on purpose. This pinned the exact expression, so adding the
   * store-build check to it broke a test about workspace-before-checkout
   * ordering -- a failure that says nothing about the ordering it guards. The
   * two facts that matter are that the destination is derived from the selected
   * plan and that it is computed after setup, not the shape of the ternary.
   */
  assert.match(setup, /const postSetupPath = useMemo\(/);
  assert.match(setup, /selectedPlan && canPresentPurchaseFlow\(\)\s*\?\s*billingPathForTier\(selectedPlan\)/);
  assert.match(
    setup,
    /:\s*'\/'/,
    'setup must fall back to the app root rather than to billing when no plan was selected',
  );
  assert.match(setup, /const cloudSaved = await persistCloudWorkspace\(\);/);
  assert.match(setup, /checkout needs the cloud workspace first/);
  assert.match(setup, /const cloudWorkspaceRequired = supabaseReady && status === 'signed-in' && !workspaceId;/);
  assert.match(setup, /workspaceReady && !saving && !cloudSetupBlocked && !cloudWorkspaceRequired/);
  assert.match(setup, /navigate\(postSetupPath, \{ replace: true \}\)/);
});

test('billing cards can select tiers even when checkout is not configured', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');

  assert.match(source, /const \[selectedTier, setSelectedTier\] = useState<SubscriptionTier>/);
  assert.match(source, /const selectTier = \(tier: SubscriptionTier\) =>/);
  assert.match(source, /!readiness\.ready\s*\?\s*`View \$\{tier\}`/);
  assert.match(source, /disabled={checkoutTier !== null}/);
  assert.doesNotMatch(source, /disabled={!readiness\.ready}/);
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

test('hosted-link-only billing reaches its payment link without calling the disabled endpoint', () => {
  /*
   * The documented link-only configuration: VITE_STRIPE_PAYMENT_LINK_* set,
   * managed billing off. api/stripe/checkout.js answers 503 before it reads a
   * billing row, so that refusal carries no code, so `canUsePaymentLinkFallback`
   * declines to follow it — and the only checkout route the deployment has was
   * suppressed. Every purchase ended in an error toast while `/api/health`
   * reported the billing configuration healthy, which for link-only billing it
   * is. The route has to be chosen from configuration, before the request.
   */
  assert.equal(
    checkoutRouteFor({ managedBillingEnabled: false, paymentLink: 'https://buy.stripe.com/test_link' }),
    'payment_link',
  );
});

test('the billing screen decides the route before it calls the endpoint', async () => {
  const screen = await readFile('src/routes/Subscriptions.tsx', 'utf8');

  // Order is the property, not the presence of a call: deciding the route
  // AFTER the endpoint answered would be the fallback again, and the fallback
  // is what suppresses the link in this configuration.
  const routeAt = screen.indexOf('checkoutRouteFor({');
  const managedAt = screen.indexOf('await startManagedCheckout(');
  assert.ok(routeAt >= 0, 'the screen must choose a checkout route from configuration');
  assert.ok(managedAt >= 0, 'the screen must still call the managed endpoint');
  assert.ok(routeAt < managedAt, 'the route must be chosen before the managed endpoint is called');
});

test('the hosted-only bypass reads the managed-billing flag, not a failure code', () => {
  /*
   * The over-rejection direction. This bypass must never widen into the
   * duplicate-charge path the allowlist closed: with managed billing ON the
   * endpoint is always called, even though a payment link is configured, so an
   * uncoded failure still stops at the error toast rather than reaching an
   * unguarded `mode: 'subscription'` link.
   */
  assert.equal(
    checkoutRouteFor({ managedBillingEnabled: true, paymentLink: 'https://buy.stripe.com/test_link' }),
    'managed',
  );

  // No link configured is not a hosted-only deployment; it is an unconfigured
  // one. Calling the endpoint is what produces the honest refusal message.
  assert.equal(checkoutRouteFor({ managedBillingEnabled: false, paymentLink: '' }), 'managed');
  assert.equal(checkoutRouteFor({ managedBillingEnabled: true, paymentLink: '' }), 'managed');

  // And the allowlist itself is untouched by any of this.
  assert.equal(canUsePaymentLinkFallback(undefined), false);
  assert.equal(canUsePaymentLinkFallback('billing_unavailable'), false);
  assert.equal(canUsePaymentLinkFallback(NO_MANAGED_IDENTITY), true);
});

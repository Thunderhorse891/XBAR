/*
 * Wiring tests for src/routes/Subscriptions.tsx — the screen where money
 * changes hands.
 *
 * The decision logic (getCheckoutReadiness, getBillingPortalAction, the
 * pending-purchase claim) is unit-tested where it lives
 * (subscriptionDecision.test.ts); this file pins the WIRING between that
 * logic and the rendered screen, which a React-less node runner cannot
 * execute but can hold to its contract:
 *
 * - which params reach startManagedCheckout (the annual toggle must actually
 *   reach the server, or an annual selection silently buys monthly);
 * - the button enable/disable states, especially the "not configured"
 *   disabled state versus the enabled state;
 * - that beginCheckout refuses before any network call;
 * - the pending-hosted-purchase notice rendering and its dismiss path.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/routes/Subscriptions.tsx', 'utf8');

function beginCheckoutBody(): string {
  const start = source.indexOf('const beginCheckout = async (tier: SubscriptionTier) => {');
  assert.ok(start >= 0, 'beginCheckout must exist');
  // beginCheckout ends right before the startTrial declaration.
  const end = source.indexOf('const startTrial = ()', start);
  assert.ok(end > start, 'beginCheckout body must be bounded');
  return source.slice(start, end);
}

test('startManagedCheckout receives the live tier, workspace, token, and billing period', () => {
  const body = beginCheckoutBody();
  const call = body.indexOf('startManagedCheckout({');
  assert.ok(call >= 0, 'beginCheckout must call startManagedCheckout');

  const args = body.slice(call, body.indexOf('});', call));
  for (const param of ['tier,', 'workspaceId,', 'billingPeriod,']) {
    assert.ok(args.includes(param), `startManagedCheckout must receive \`${param}\` (found: ${args})`);
  }
  assert.ok(
    args.includes('accessToken: session?.access_token ??'),
    'the managed endpoint needs the access token; without it the server cannot authorize the workspace',
  );

  // The annual toggle is state, not a constant: pin that the selected period
  // is what is sent, so flipping to annual cannot silently buy monthly.
  assert.ok(
    source.includes("const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');"),
    'the billing period must be selectable state defaulting to monthly',
  );
  assert.ok(!args.includes("billingPeriod: 'monthly'"), 'the period sent must be the selected one, not a constant');
});

test('the primary action is disabled exactly when checkout is not ready or the plan is current', () => {
  assert.ok(
    source.includes('disabled={!selectedReadiness.ready || selectedPaidCurrent}'),
    'the CTA disabled state must be driven by the readiness answer, not by local flags',
  );
  assert.ok(
    source.includes("selectedReadiness.mode === 'manual'"),
    'the not-configured mode must have its own label branch',
  );
  assert.ok(
    source.includes("'Billing not configured yet'"),
    'an unconfigured deployment must say billing is not configured on the CTA itself',
  );
  assert.ok(
    source.includes('Billing is not configured yet, so plans cannot be purchased in the app.'),
    'the unconfigured notice must say plainly that nothing can be purchased',
  );
});

test('all three readiness call sites are fed the live billing state', () => {
  // getCheckoutReadiness is called three times (selectedReadiness,
  // renderPaidPlan, beginCheckout). Every one must pass the same live inputs;
  // a call site that dropped subscriptionActive or billingEnabled would
  // answer a different question than the button it guards.
  const calls = source.split('getCheckoutReadiness({').slice(1);
  assert.equal(calls.length, 3, 'expected exactly three getCheckoutReadiness call sites');

  const requiredInputs = [
    'billingEnabled,',
    'canManageBilling,',
    'hasManagedIdentity,',
    'hasPaymentLink:',
    'checkoutInProgress:',
    'subscriptionRecoverable,',
    'subscriptionActive,',
    'hasBillingPortal,',
    'nativeApp,',
  ];
  for (const [index, call] of calls.entries()) {
    const args = call.slice(0, call.indexOf('});'));
    for (const input of requiredInputs) {
      assert.ok(args.includes(input), `call site ${index + 1} must pass \`${input}\``);
    }
  }
});

test('beginCheckout refuses before any network call when not ready', () => {
  const body = beginCheckoutBody();

  const readinessCheck = body.indexOf('if (!readiness.ready) {');
  assert.ok(readinessCheck >= 0, 'beginCheckout must refuse when the readiness answer is not ready');

  const refusedBlock = body.indexOf('setCheckoutTier(null);', readinessCheck);
  assert.ok(refusedBlock > readinessCheck, 'a refused checkout must reset the in-progress state');

  const managedCall = body.indexOf('startManagedCheckout({');
  assert.ok(managedCall > refusedBlock, 'the managed endpoint must only be called after the readiness gate');

  const paymentLinkRoute = body.indexOf('checkoutRouteFor({ managedBillingEnabled: billingEnabled,');
  assert.ok(paymentLinkRoute > refusedBlock, 'the hosted-link route must also sit behind the readiness gate');
});

test('a refused checkout tells the user the workspace was not changed', () => {
  const body = beginCheckoutBody();
  assert.ok(
    body.includes('Your workspace and current plan were not changed.'),
    'a refused checkout must reassure that nothing was charged or changed',
  );
});

test('plan cards never start checkout when not ready; they route to the portal instead', () => {
  assert.ok(
    source.includes('disabled={checkoutTier !== null}'),
    'plan card buttons disable only while a checkout is in flight',
  );

  const chooseTierStart = source.indexOf('const chooseTier = () => {');
  assert.ok(chooseTierStart >= 0, 'chooseTier must exist');
  const chooseTier = source.slice(chooseTierStart, source.indexOf('};', source.indexOf('void beginCheckout(tier);')));

  const readinessBranch = chooseTier.indexOf('if (!readiness.ready) {');
  assert.ok(readinessBranch >= 0, 'chooseTier must branch on readiness');
  const beginCall = chooseTier.indexOf('void beginCheckout(tier);', readinessBranch);
  assert.ok(beginCall > readinessBranch, 'chooseTier must be able to reach beginCheckout when ready');
  assert.ok(
    chooseTier.slice(readinessBranch, beginCall).includes('return;'),
    'a non-ready card must return before it can reach beginCheckout',
  );
  assert.ok(
    chooseTier.includes('if (billingPortalAction) openBillingPortal();'),
    'a non-ready card with a portal action must offer the portal — the place an existing subscription is actually changed',
  );
});

test('the pending hosted purchase notice renders with a working dismiss', () => {
  assert.ok(
    source.includes('{purchaseAwaitingActivation && pendingPurchase ? ('),
    'the notice must render only while a purchase is actually awaiting activation',
  );
  assert.ok(
    source.includes('pendingHostedPurchaseNotice(pendingPurchase)'),
    'the notice copy must come from the pending-purchase helper, not ad-hoc text',
  );
  assert.ok(
    source.includes('I did not complete that purchase'),
    'the notice must offer the way out in the same breath',
  );
  assert.ok(
    source.includes('onClick={forgetPendingPurchase}'),
    'the dismiss button must be wired to forgetPendingPurchase',
  );

  const forgetStart = source.indexOf('const forgetPendingPurchase = () => {');
  assert.ok(forgetStart >= 0, 'forgetPendingPurchase must exist');
  const forgetBody = source.slice(forgetStart, source.indexOf('};', forgetStart));
  assert.ok(
    forgetBody.includes('clearPendingHostedPurchase(workspaceId)'),
    'dismissing must clear the stored pending purchase for this workspace',
  );
  assert.ok(forgetBody.includes('setPendingPurchase(null)'), 'dismissing must clear the rendered notice immediately');
});

test('the payment-link fallback stays behind its allowlist', () => {
  const body = beginCheckoutBody();
  assert.ok(
    body.includes('canUsePaymentLinkFallback(managed.code)'),
    'only the no-managed-identity refusal may fall back to a payment link; a network error or server refusal must not',
  );
  assert.ok(
    body.includes('getStripePaymentLink(tier, billingPeriod)'),
    'the fallback link must honor the selected billing period — with no annual link configured there is no fallback',
  );
});

test('the hosted-only route claims the purchase before leaving the page', () => {
  assert.ok(
    source.includes('await followPaymentLink(tier, hostedOnlyLink);'),
    'the hosted-only primary route must go through followPaymentLink',
  );
  const followStart = source.indexOf('const followPaymentLink = async (');
  assert.ok(followStart >= 0, 'followPaymentLink must exist');
  const followBody = source.slice(followStart, source.indexOf('const openBillingPortal', followStart));
  assert.ok(
    followBody.includes('claimPendingHostedPurchase('),
    'leaving for a hosted link must claim the pending purchase first, so the screen stops offering it',
  );
  assert.ok(
    followBody.includes('window.location.assign(link);'),
    'followPaymentLink is the single place that assigns to a payment link',
  );
  assert.equal(
    (source.match(/window\.location\.assign\(link\)/g) || []).length,
    1,
    'there must be no second assign-to-link that could bypass the claim',
  );
});

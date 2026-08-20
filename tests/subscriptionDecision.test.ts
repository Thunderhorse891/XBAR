import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getCheckoutReadiness,
  isCurrentPaidPlan,
  isEntitledBillingState,
  planOutcomes,
  recommendedTier,
} from '../src/lib/subscriptionDecision.js';
import type { SubscriptionProfile, SubscriptionTier } from '../src/types/xbar.js';
import { subscriptionPlans } from '../src/lib/subscriptionPlans.js';

test('hosted payment links keep checkout available when managed billing is paused', () => {
  const result = getCheckoutReadiness({
    billingEnabled: false,
    canManageBilling: true,
    hasManagedIdentity: false,
    hasPaymentLink: true,
    checkoutInProgress: false,
  });
  assert.equal(result.ready, true);
  assert.match(result.reason, /Secure checkout opens next/);
});
test('checkout is unavailable without billing permission', () => {
  const result = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: false,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /workspace owner/);
});
test('checkout is unavailable when neither managed billing nor a payment link can charge', () => {
  const result = getCheckoutReadiness({
    billingEnabled: false,
    canManageBilling: true,
    hasManagedIdentity: false,
    hasPaymentLink: false,
    checkoutInProgress: false,
  });
  assert.equal(result.ready, false);
  assert.equal(result.mode, 'manual');
  // Deliberately not "contact support / manual billing": with Stripe absent
  // there is no route the customer can take, so the copy says so plainly.
  assert.match(result.reason, /Billing is not configured yet/);
  assert.doesNotMatch(result.reason, /manual billing/i);
});
test('local managed checkout still needs sign-in when no payment link exists', () => {
  const result = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: false,
    hasPaymentLink: false,
    checkoutInProgress: false,
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /Sign in/);
});
test('managed identity or a payment link makes checkout available', () => {
  assert.equal(
    getCheckoutReadiness({
      billingEnabled: true,
      canManageBilling: true,
      hasManagedIdentity: true,
      hasPaymentLink: false,
      checkoutInProgress: false,
    }).ready,
    true,
  );
  assert.equal(
    getCheckoutReadiness({
      billingEnabled: true,
      canManageBilling: true,
      hasManagedIdentity: false,
      hasPaymentLink: true,
      checkoutInProgress: false,
    }).ready,
    true,
  );
});
test('recommendation moves one operating level at a time and respects selection', () => {
  assert.equal(recommendedTier('Starter'), 'Professional');
  assert.equal(recommendedTier('Enterprise'), 'Enterprise');
  assert.equal(recommendedTier('Starter', 'Ranch Ops'), 'Ranch Ops');
  assert.match(planOutcomes['Ranch Ops'].join(' '), /one rhythm/);
});
test('subscription prices stay aligned to the current approved pricing table', () => {
  assert.equal(subscriptionPlans.Starter.monthlyRate, 29);
  assert.equal(subscriptionPlans.Professional.monthlyRate, 79);
  assert.equal(subscriptionPlans['Ranch Ops'].monthlyRate, 199);
  assert.equal(subscriptionPlans.Enterprise.monthlyRate, 499);
});

test('no configuration produces a purchasable path when Stripe is absent', () => {
  // The promise this pins: with no managed billing and no payment link, there
  // is no combination of the remaining inputs that reports ready. A checkout
  // button that opens nothing, or a flow that reports success without a
  // payment, would both show up here as ready: true.
  for (const canManageBilling of [true, false]) {
    for (const hasManagedIdentity of [true, false]) {
      for (const checkoutInProgress of [true, false]) {
        const result = getCheckoutReadiness({
          billingEnabled: false,
          hasPaymentLink: false,
          canManageBilling,
          hasManagedIdentity,
          checkoutInProgress,
        });

        assert.equal(
          result.ready,
          false,
          `ready with billingEnabled=false hasPaymentLink=false canManage=${canManageBilling} identity=${hasManagedIdentity} inProgress=${checkoutInProgress}`,
        );
      }
    }
  }
});

test('a configured payment link is still purchasable', () => {
  // Guards the fix: the assertion above must not be satisfiable by a decision
  // function that simply never reports ready.
  const result = getCheckoutReadiness({
    billingEnabled: false,
    hasPaymentLink: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    checkoutInProgress: false,
  });
  assert.equal(result.ready, true);
  assert.equal(result.mode, 'checkout');
});

/*
 * A stored price is not proof of a live plan.
 *
 * `monthlyRate` is the rate of the plan that was bought, and it outlives a
 * cancellation. Four places used `monthlyRate > 0` as the "this plan is
 * current" signal, so a canceled Starter subscription looked like a current
 * Starter subscription: the billing screen labelled it as the active plan and
 * disabled its checkout button, leaving the customer unable to resubscribe to
 * the tier they had just lost, and the setup checklist marked billing complete.
 */

function profileWith(billingState: SubscriptionProfile['billingState'], tier: SubscriptionTier) {
  return { tier, monthlyRate: 29, billingState } as SubscriptionProfile;
}

test('only a paying or comped state counts as entitled', () => {
  assert.equal(isEntitledBillingState('Active'), true);
  assert.equal(isEntitledBillingState('Manual Billing'), true);
  assert.equal(isEntitledBillingState('Past Due'), false);
  assert.equal(isEntitledBillingState('Inactive'), false);
});

test('a lapsed plan is not the current plan, whatever its stored price says', () => {
  for (const billingState of ['Inactive', 'Past Due'] as const) {
    const subscription = profileWith(billingState, 'Starter');

    assert.equal(subscription.monthlyRate > 0, true, 'precondition: the old price is still stored');
    assert.equal(
      isCurrentPaidPlan(subscription, 'Starter'),
      false,
      `${billingState} must not present Starter as current, or its checkout is disabled and the customer cannot resubscribe`,
    );
  }
});

test('an entitled plan is current for its own tier and no other', () => {
  const subscription = profileWith('Active', 'Professional');

  assert.equal(isCurrentPaidPlan(subscription, 'Professional'), true);
  assert.equal(isCurrentPaidPlan(subscription, 'Starter'), false);
  assert.equal(isCurrentPaidPlan(subscription, 'Enterprise'), false);
});

test('no screen infers an active plan from the stored price', async () => {
  // The predicate only helps if nothing bypasses it. These are the consumers
  // that previously read the rate directly.
  for (const consumer of [
    'src/routes/Subscriptions.tsx',
    'src/routes/GettingStarted.tsx',
    'src/store/useXbarStore.ts',
  ]) {
    const source = await readFile(path.join(process.cwd(), consumer), 'utf8');
    assert.doesNotMatch(
      source,
      /monthlyRate > 0/,
      `${consumer} uses a stored price as an activity signal; use isEntitledBillingState / isCurrentPaidPlan`,
    );
  }
});

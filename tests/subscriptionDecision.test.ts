import assert from 'node:assert/strict';
import test from 'node:test';
import { getCheckoutReadiness, planOutcomes, recommendedTier } from '../src/lib/subscriptionDecision.js';
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
  assert.match(result.reason, /Online checkout is not configured/);
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

// App Store Review Guideline 3.1.1: a store build must not offer, or link out
// to, a purchase that bypasses In-App Purchase. The native flag is checked
// before every other rule, so no combination of role or Stripe configuration
// can reopen a purchase path inside the app.
test('a native store build is never ready to purchase, even fully configured as an owner', () => {
  const result = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    nativeApp: true,
  });
  assert.equal(result.ready, false);
  assert.equal(result.mode, 'external');
  assert.match(result.reason, /managed outside the app/i);
});

test('a native store build stays closed to purchase for every other input combination', () => {
  for (const billingEnabled of [true, false]) {
    for (const canManageBilling of [true, false]) {
      for (const hasManagedIdentity of [true, false]) {
        for (const hasPaymentLink of [true, false]) {
          const result = getCheckoutReadiness({
            billingEnabled,
            canManageBilling,
            hasManagedIdentity,
            hasPaymentLink,
            checkoutInProgress: false,
            nativeApp: true,
          });
          assert.equal(result.ready, false);
          assert.equal(result.mode, 'external');
        }
      }
    }
  }
});

test('omitting the native flag leaves web checkout behavior unchanged', () => {
  const web = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
  });
  const explicitWeb = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    nativeApp: false,
  });
  assert.equal(web.ready, true);
  assert.deepEqual(web, explicitWeb);
});

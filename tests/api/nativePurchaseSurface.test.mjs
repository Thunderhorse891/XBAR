import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/*
 * Every route out of the app to a purchase must sit behind the native gate.
 *
 * App Store Review Guideline 3.1.1 forbids a store build from sending a
 * customer to a non-IAP purchase, and forbids the call to action as well as
 * the charge. `getCheckoutReadiness` refuses when `nativeApp` is set, and
 * tests/subscriptionDecision.test.ts sweeps all 128 input combinations to prove
 * it. That is only half the guarantee: a refusal enforces nothing if some other
 * code path navigates to Stripe without asking.
 *
 * That is not hypothetical. It is exactly what shipped in the first version of
 * this gate. `getCheckoutReadiness` was closed and `getBillingPortalAction` was
 * not, so the portal — which the deployment docs describe as where a subscriber
 * goes to "upgrade, downgrade, settle a failed payment, or cancel" — was still
 * created, still rendered, and still followed with window.location.assign. It
 * was the PRIMARY action for an active or recoverable subscription, which is
 * precisely the set of customers the checkout gate turns away, so the gate
 * looked like it worked while routing the people it most needed to stop.
 *
 * A per-call-site check is what catches the third occurrence. Adding a new
 * navigation to Stripe and forgetting the gate fails here rather than in App
 * Review, where the cost is a rejected binary and another submission cycle.
 */

const source = readFileSync(path.join(process.cwd(), 'src/routes/Subscriptions.tsx'), 'utf8');

// The only functions permitted to navigate out of the app to a purchase, and
// what makes each of them safe.
const GATED_NAVIGATIONS = [
  {
    // Hosted Stripe payment link.
    fn: 'followPaymentLink',
    // Reached only from beginCheckout, which returns before any navigation
    // whenever readiness is not ready — and nativeApp forces exactly that.
    guardedBy: 'beginCheckout',
  },
  {
    // Stripe-managed Checkout Session.
    fn: 'beginCheckout',
    guardedBy: 'getCheckoutReadiness',
  },
  {
    // Stripe billing portal.
    fn: 'openBillingPortal',
    // Returns early unless billingPortalAction exists, and
    // getBillingPortalAction returns null for a store build.
    guardedBy: 'billingPortalAction',
  },
];

test('every purchase navigation in Subscriptions.tsx is behind the native gate', () => {
  const assignments = [...source.matchAll(/window\.location\.assign\(/g)];
  assert.equal(
    assignments.length,
    GATED_NAVIGATIONS.length,
    `Subscriptions.tsx has ${assignments.length} window.location.assign call(s) but ${GATED_NAVIGATIONS.length} are accounted for as gated. ` +
      'A new one must either go through getCheckoutReadiness/getBillingPortalAction or be added here with the reason it is safe.',
  );

  for (const { fn, guardedBy } of GATED_NAVIGATIONS) {
    assert.ok(source.includes(`${fn} =`), `${fn} no longer exists; this guard list is stale`);
    assert.ok(source.includes(guardedBy), `${fn} lost its guard (${guardedBy})`);
  }
});

test('both native gates are actually consulted by this screen', () => {
  // The flag has to reach BOTH decisions. Passing it to one and not the other
  // is the precise shape of the defect described above, and it type-checks.
  assert.ok(source.includes('const nativeApp = isNativeApp()'), 'the store-build flag is no longer read');

  for (const decision of ['getCheckoutReadiness', 'getBillingPortalAction']) {
    const calls = [...source.matchAll(new RegExp(`${decision}\\(\\{([\\s\\S]*?)\\}\\)`, 'g'))];
    assert.ok(calls.length > 0, `${decision} is no longer called here`);
    for (const [, args] of calls) {
      assert.match(args, /\bnativeApp\b/, `a ${decision} call omits nativeApp, reopening the purchase path on iOS`);
    }
  }
});

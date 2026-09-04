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

/*
 * The paywall is what Apple reviews, not just the button at the end of it.
 *
 * The first version of this gate disabled the CTA and left the rest of the
 * payment panel intact, so a store build with Stripe configured still read
 * "Due at checkout" and rendered a "Card details / Secure checkout" box with
 * card number, expiration and CVC rows. Guideline 3.1.1 forbids PRESENTING a
 * non-IAP purchase, so a screen showing a card form is the rejection whether
 * or not anything can be bought behind it.
 */
test('the store build never presents the checkout panel', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/routes/Subscriptions.tsx'), 'utf8');

  // Everything that reads as "a purchase happens here" hangs off this one
  // flag, so it is the flag that has to know about the store build.
  assert.match(
    source,
    /const selectedCheckoutConfigured = !nativeApp &&/,
    'the payment panel no longer accounts for a store build, so it will show card fields and "Due at checkout" on iOS',
  );

  // And the card-details box needs its own branch: it is rendered by the
  // fall-through, which a disabled button does not affect.
  assert.match(
    source,
    /selectedReadiness\.mode === 'external' \? \(/,
    'the card-details box has no store-build branch, so a store build renders a card form',
  );
});

/*
 * A call to action to upgrade is forbidden too, wherever it appears.
 *
 * These sit far from the billing screen -- a usage meter, a locked financials
 * panel, a horse profile, the breeding screen -- which is exactly why gating
 * the billing screen alone missed them. Each one is a button reading "Upgrade
 * to ..." that leads to a flow a store build deliberately refuses: a call to
 * action under 3.1.1, and a dead end for the customer either way.
 *
 * "Compare billing" and the Billing nav item are deliberately NOT in this list.
 * Showing what a plan includes is allowed and is what the store build is meant
 * to do; only the call to BUY is removed.
 */
test('every upgrade call to action is hidden in a store build', () => {
  const CTA_FILES = [
    'src/components/UsageMeterPanel.tsx',
    'src/routes/Financials.tsx',
    'src/routes/AnimalProfile.tsx',
    'src/routes/Breeding.tsx',
  ];

  for (const file of CTA_FILES) {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.match(
      source,
      /Upgrade to/,
      `${file} no longer has an upgrade call to action; this guard list is stale and should be trimmed`,
    );
    assert.match(
      source,
      /canPresentPurchaseFlow\(\)/,
      `${file} shows an upgrade call to action that a store build does not hide`,
    );
  }
});

/*
 * An emailed auth link has to point somewhere an email client can open.
 *
 * authCallbackOrigin() existed and was imported by nothing, so every magic
 * link, signup confirmation and password reset was still built from
 * window.location.origin -- `capacitor://localhost` in a store build. Supabase
 * will not accept that as a redirect and no mail client can open it, so signup
 * could not complete where confirmation is required and "Forgot password?" sent
 * a dead link. Both are broken features under Guideline 2.1.
 */
test('emailed auth callbacks do not point at capacitor://localhost', () => {
  const raw = readFileSync(path.join(process.cwd(), 'src/store/useCloudStore.ts'), 'utf8');
  // Comments stripped first. The prose above this helper names
  // authCallbackOrigin() to explain why it is there, so matching the raw file
  // passes even when the CALL has been deleted -- a test that cannot fail for
  // the reason it exists. This was caught by mutation-testing it.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.match(
    source,
    /authCallbackOrigin\(\)/,
    'auth redirects no longer consult the native callback origin, so emailed links die on capacitor://localhost',
  );

  // Every emailed redirect is built by this one helper. If a call site ever
  // reads window.location.origin directly again, it bypasses the fix.
  const direct = [...source.matchAll(/emailRedirectTo:\s*`\$\{window\.location\.origin/g)];
  assert.equal(direct.length, 0, 'an auth redirect builds its URL from window.location.origin directly');
});

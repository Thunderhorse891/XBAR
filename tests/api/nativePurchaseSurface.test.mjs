import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
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
 * A call to action to upgrade is forbidden too, wherever it appears -- and
 * "wherever" is the whole difficulty.
 *
 * These sit far from the billing screen: a usage meter, a locked financials
 * panel, a horse profile, the breeding screen, the reports hero, an expenses
 * panel. Gating the billing screen missed all of them.
 *
 * The first version of this test then listed the four that were known and
 * checked each for the gate. That is the same mistake one level up: an
 * allowlist cannot report the file nobody put in it, and review immediately
 * found two more. One of them read "Unlock with Ranch Ops", which the list's
 * own /Upgrade to/ pattern would not have matched even had the file been in it.
 *
 * So this DISCOVERS instead. Any source file that navigates to the billing
 * route and carries purchase-invitation copy has to consult the gate. A new
 * upgrade button anywhere in src/ fails here, without anyone remembering to
 * add it.
 */
const BILLING_NAVIGATION = /navigate\(billingPath|to=\{billingPath/;
// The invitation to BUY. Deliberately not "Billing" or "Compare billing":
// showing what a plan includes is allowed under 3.1.1, and is what the store
// build is for. Only the call to purchase is removed.
const PURCHASE_CTA_COPY = /\b(?:Upgrade|Unlock with)\b/;

function sourceFilesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test('every upgrade call to action is hidden in a store build', () => {
  const offenders = [];
  let found = 0;

  for (const file of sourceFilesUnder(path.join(process.cwd(), 'src'))) {
    const source = readFileSync(file, 'utf8');
    if (!BILLING_NAVIGATION.test(source) || !PURCHASE_CTA_COPY.test(source)) continue;
    found += 1;
    if (!source.includes('canPresentPurchaseFlow()')) {
      offenders.push(path.relative(process.cwd(), file));
    }
  }

  // If this ever drops to zero the patterns have drifted and the test is
  // silently passing over everything, which is worse than failing.
  assert.ok(found > 0, 'no upgrade call to action was found at all; the detection patterns have gone stale');

  assert.deepEqual(
    offenders,
    [],
    `these files invite a purchase without asking whether this is a store build: ${offenders.join(', ')}`,
  );
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

/*
 * The app and the marketing site are two roots on one origin.
 *
 * `npm run build` moves the SPA shell to app.html, served under /app/*, and
 * replaces / with static marketing HTML that has no router and ignores a hash.
 * Verified from the build output, not assumed: dist/index.html carries no
 * `id="root"` and no hash handling; dist/app.html is the shell.
 *
 * These were one variable, and the failure mode is the dangerous kind -- it
 * renders. buildPublicShareUrl consumes the app URL, so pointing it at the site
 * root turns every shared, copied and emailed buyer link into
 * `https://site/#/profiles/<id>`, which loads the marketing homepage, looks
 * like a working page, and never shows the horse.
 */
test('the mobile build points in-app links at the SPA, not the marketing root', () => {
  const source = readFileSync(path.join(process.cwd(), 'scripts/build-mobile.mjs'), 'utf8');

  assert.match(
    source,
    /VITE_PUBLIC_SITE_URL/,
    'the mobile build no longer sets a marketing origin, so legal links resolve against the SPA base',
  );
  assert.match(
    source,
    /\$\{publicSiteUrl\}\/app/,
    'the mobile build no longer derives the app base from /app, so buyer share links load the marketing homepage',
  );

  // Both have to reach the bundle. Computing them and passing one is the same
  // class of miss as computing authCallbackOrigin and never calling it.
  const env = source.slice(source.indexOf('const env = {'));
  for (const key of ['VITE_PUBLIC_SITE_URL', 'VITE_PUBLIC_APP_URL', 'VITE_NATIVE_APP']) {
    assert.match(env, new RegExp(`${key}:`), `${key} is computed but never passed to the build`);
  }
});

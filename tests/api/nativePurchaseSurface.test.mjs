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
 * Every route to the billing screen is gated, unless it is plainly navigation.
 *
 * This assertion has now been wrong three times, each in a different way, and
 * the shape of the fixes is the point.
 *
 *   v1 listed four files and checked each for the gate. It could not report a
 *      fifth, and review found two.
 *   v2 discovered files by CTA copy -- /Upgrade|Unlock with/. It missed
 *      "See Ranch Ops", because a conversion prompt does not have to contain
 *      any particular word.
 *   v3 (this) stops trying to recognise a call to action at all.
 *
 * Matching on copy cannot work: the set of ways to invite a purchase is not
 * enumerable, and every miss ships. So the default is inverted. EVERY
 * navigation to the billing route must be gated, and the only exceptions are
 * the ones written down here with a reason. A new upgrade button fails by
 * DEFAULT -- someone has to deliberately add it below to make it pass, and
 * write down why it is not a call to action.
 *
 * Counted per navigation rather than per file, because that is how v2 let the
 * second Reports CTA through: the file already imported the gate for its hero
 * button, so a whole-file check was satisfied while a second, ungated button
 * sat further down the same screen.
 */
/*
 * Any REFERENCE to the billing route, not two particular call shapes.
 *
 * v3 matched `navigate(billingPath` and `to={billingPath`. GettingStarted.tsx
 * put the destination in a data array -- `to: billingPath`, navigated later as
 * `navigate(s.to)` -- and neither pattern saw it. A third syntax existed, so
 * enumerating syntaxes fails for the same reason enumerating copy did.
 *
 * Now: if a file mentions the billing route at all, outside its imports, it
 * must gate or be exempted. Naming the route in an import is not routing to it,
 * so import lines are stripped first.
 */
/*
 * Deliberately NOT /g. `assert.match` runs RegExp.test, which advances
 * lastIndex on a global regex, so the second call against a different file
 * starts mid-string and can report no match on a file that plainly has one.
 * Counting below builds its own global copy instead.
 */
const BILLING_NAVIGATION = /\b(?:billingPath|billingPathForTier|subscriptionUpgradePath)\b/;
/*
 * One DESTINATION, not one identifier.
 *
 * `selectedPlan ? billingPathForTier(selectedPlan) : billingPath` names the
 * route twice while being a single place the customer can be sent, and a
 * single gate covers it. Counting raw identifiers made Login look like four
 * destinations with three gates and reported a file that is fully gated.
 *
 * Collapsed first, so the count is of places rather than mentions.
 */
const collapseTernaries = (source) =>
  source.replace(/billingPathForTier\([^)]*\)\s*:\s*billingPath\b/g, 'BILLING_DESTINATION');
const countBillingRefs = (source) =>
  (collapseTernaries(source).match(new RegExp(BILLING_NAVIGATION.source, 'g')) ?? []).length +
  (collapseTernaries(source).match(/BILLING_DESTINATION/g) ?? []).length;
const IMPORT_STATEMENT = /^import[\s\S]*?;\s*$/gm;
const PURCHASE_GATE = /canPresentPurchaseFlow\(\)/g;

/*
 * Navigation to the billing SCREEN, which is not an invitation to buy.
 *
 * Showing what a plan includes is allowed under 3.1.1 and is exactly what the
 * store build is for: it is the screen that explains billing is handled
 * elsewhere. Removing these would strand a customer who hits a limit with no
 * way to find out what they would need -- a worse app for no policy gain.
 */
const PLAIN_NAVIGATION = new Map([
  ['src/App.tsx', 'Route redirects (/subscribe, /plans, /subscriptions), not controls at all.'],
  [
    'src/routes/layouts/MainLayout.tsx',
    'The Billing nav button and its menu entry, always available and never a pitch.',
  ],
  ['src/lib/billingRoutes.ts', 'Defines the route. Nothing to gate; gating here would gate everything.'],
  ['src/lib/subscriptionGates.ts', 'Re-exports the path and holds gate COPY. Renders nothing itself.'],
  ['src/lib/activation.ts', 'Builds a checklist nothing renders -- only its own test imports it.'],
]);

/*
 * Three entries were removed from that list, and why is worth recording.
 *
 * They were exempted on the strength of their BUTTON LABELS -- "Compare
 * billing", "View Billing", a post-refusal redirect -- which is the same
 * "recognise a call to action by its text" reasoning this file abandoned one
 * revision earlier, smuggled back in at file granularity.
 *
 * Read in context they are pitches. RequireSubscriptionFeature renders its
 * button under "Sale listings are available on Professional and higher plans.
 * Upgrade to publish buyer-ready horse profiles." Documents renders "Upgrading
 * to Professional unlocks the watermarked PDF and Buyer follow-up" and puts the
 * button in that sentence. A neutral label under an upgrade pitch is an upgrade
 * control.
 *
 * Nothing is lost by gating them: MainLayout's Billing entry stays, so a store
 * build can still reach the screen that explains what each plan includes.
 */

function sourceFilesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test('every route to billing is gated for a store build, or listed as plain navigation', () => {
  const offenders = [];
  let navigations = 0;

  for (const file of sourceFilesUnder(path.join(process.cwd(), 'src'))) {
    const relative = path.relative(process.cwd(), file).split(path.sep).join('/');
    const source = readFileSync(file, 'utf8').replace(IMPORT_STATEMENT, '');
    const navs = countBillingRefs(source);
    if (!navs) continue;
    navigations += navs;
    if (PLAIN_NAVIGATION.has(relative)) continue;

    const gates = (source.match(PURCHASE_GATE) ?? []).length;
    if (gates < navs) {
      offenders.push(`${relative} (${navs} route(s) to billing, ${gates} gated)`);
    }
  }

  assert.ok(navigations > 0, 'no billing navigation found at all; the detection pattern has gone stale');
  assert.deepEqual(
    offenders,
    [],
    `these send a customer to billing without asking whether this is a store build. Gate them with canPresentPurchaseFlow(), or add them to PLAIN_NAVIGATION with the reason they are not a call to action: ${offenders.join('; ')}`,
  );
});

test('the plain-navigation exceptions all still exist', () => {
  // An allowlist that names a file nobody has touched in a year is how a real
  // CTA gets in later under a stale exemption.
  for (const [file] of PLAIN_NAVIGATION) {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8').replace(IMPORT_STATEMENT, '');
    assert.match(
      source,
      BILLING_NAVIGATION,
      `${file} is exempted from the billing gate but no longer references it; remove the exemption`,
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

/*
 * VITE_PUBLIC_APP_URL is an ORIGIN. It must never carry a path.
 *
 * An earlier revision set it to `<site>/app`, reasoning that the SPA is served
 * there. It is not a client-only variable: api/sale-packets.js builds
 * `${appOrigin}/app/verify/<id>` from it and api/invite.js concatenates it the
 * same way, so a value carrying `/app` produced `/app/app/verify/<id>` and
 * broke the verification link printed inside every sale packet -- the one
 * artifact whose entire purpose is being checkable by a stranger.
 *
 * VITE_PUBLIC_SITE_URL is separate because in-app links to /privacy and /terms
 * are marketing pages, and inside a store build a bare path is a dead link.
 */
test('the mobile build passes origins, never paths, to the bundle', () => {
  const source = readFileSync(path.join(process.cwd(), 'scripts/build-mobile.mjs'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.doesNotMatch(
    code,
    /publicAppUrl\s*=\s*[^;]*\/app`/,
    'the app URL carries a /app path again; the server appends its own and will produce /app/app/verify/<id>',
  );
  assert.match(code, /VITE_PUBLIC_SITE_URL/, 'the mobile build no longer passes a marketing origin for legal links');

  // Both have to reach the bundle. Computing a value and not passing it is the
  // same class of miss as authCallbackOrigin being written and never called.
  const env = code.slice(code.indexOf('const env = {'));
  for (const key of ['VITE_PUBLIC_SITE_URL', 'VITE_PUBLIC_APP_URL', 'VITE_NATIVE_APP']) {
    assert.match(env, new RegExp(`${key}:`), `${key} is computed but never passed to the build`);
  }
});

test('the server still appends its own /app to the configured origin', () => {
  // The consumer that made the path-carrying value wrong. If this ever stops
  // appending, the origin-only rule above needs revisiting rather than silently
  // becoming half a convention.
  const source = readFileSync(path.join(process.cwd(), 'api/sale-packets.js'), 'utf8');
  assert.match(
    source,
    /\$\{appOrigin\}\/app\/verify\//,
    'sale-packets no longer builds the verify URL by appending /app; the origin-only rule may no longer hold',
  );
});

/*
 * activation.ts is exempted because nothing renders it. That has to stay true.
 *
 * It builds a checklist with a "Review billing" step whose `complete` is the
 * paid-plan check -- unfinishable in a store build, exactly like the one
 * removed from GettingStarted. It is harmless only while no screen shows it.
 */
test('the unrendered activation checklist stays unrendered', () => {
  const offenders = [];
  for (const file of sourceFilesUnder(path.join(process.cwd(), 'src'))) {
    const relative = path.relative(process.cwd(), file).split(path.sep).join('/');
    if (relative === 'src/lib/activation.ts') continue;
    if (/buildActivationSteps|summarizeActivation/.test(readFileSync(file, 'utf8'))) offenders.push(relative);
  }
  assert.deepEqual(
    offenders,
    [],
    `activation.ts is now rendered by ${offenders.join(', ')}; its billing step is unfinishable in a store build and needs gating like GettingStarted's`,
  );
});

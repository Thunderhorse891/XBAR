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
const BILLING_NAVIGATION = /navigate\(billingPath|to=\{billingPath/g;
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
  ['src/components/RequireSubscriptionFeature.tsx', '"Compare billing" -- reads the plan, does not buy it.'],
  ['src/components/SalePacketWizard.tsx', 'Routes to plan information after a tier block, with no CTA.'],
  ['src/routes/Documents.tsx', '"Open Billing page" and "View Billing" -- named navigation.'],
  ['src/routes/layouts/MainLayout.tsx', 'The Billing nav button and its menu entry.'],
]);

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
    const source = readFileSync(file, 'utf8');
    const navs = (source.match(BILLING_NAVIGATION) ?? []).length;
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
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.match(
      source,
      /navigate\(billingPath|to=\{billingPath/,
      `${file} is exempted from the billing gate but no longer navigates to billing; remove the exemption`,
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

/*
 * Hiding OAuth must not lock anyone out.
 *
 * The store build removes the Google, Apple and Facebook buttons, because
 * signInWithOAuth navigates the WebView to the provider and returns to
 * capacitor://localhost -- a redirect Google refuses and Supabase will not
 * accept. That is correct, and on its own it strands every account created
 * through those providers: they have no password, so the password form cannot
 * help them and "Forgot password?" resets a password that was never set. They
 * would install the app and have no route in at all.
 *
 * So removing the buttons and offering nothing in their place is not an option
 * the store build is allowed to be in, and that is what this asserts: the two
 * decisions live in one file and have to move together.
 */
test('a store build that hides OAuth still offers a way in', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/routes/Login.tsx'), 'utf8');

  assert.match(
    source,
    /canPresentThirdPartySignIn\(\)/,
    'the login screen no longer gates third-party sign-in for a store build',
  );
  // Two independent facts, not a proximity match: the handler sits some 5KB
  // from the JSX that renders it, so any "these appear near each other" regex
  // is really measuring file layout. It fails on correct code the moment
  // someone moves a function.
  assert.match(
    source,
    /!canPresentThirdPartySignIn\(\)/,
    'the store build hides OAuth with no branch offering anything in its place, stranding password-less accounts',
  );
  // A CODE, not a magic link. A link signs the customer in wherever it opens,
  // which is a browser -- the app never receives the session, so an OAuth-only
  // account is still locked out of iOS. Only an in-app exchange fixes it, so
  // both halves have to be here.
  assert.match(
    source,
    /cloud\.sendEmailCode\(/,
    'the login screen never requests an emailed sign-in code, so an OAuth-only account has no route into the app',
  );
  assert.match(
    source,
    /cloud\.verifyEmailCode\(/,
    'a code can be requested but never exchanged in the app, so the session never reaches the store build',
  );

  // The control has to explain who it is for. An OAuth-only customer has no
  // reason to guess that an emailed link is now their route in.
  assert.match(
    source,
    /signed up with Google, Apple or Facebook/,
    'the emailed sign-in offers no explanation, so an OAuth-only customer will read the app as broken',
  );
});

/*
 * The native billing panel must not say where to buy either.
 *
 * Guideline 3.1.1 forbids calls to action that direct a customer to a
 * purchasing mechanism other than In-App Purchase, and that covers a plain
 * instruction as much as a link or a button. An earlier version of this panel
 * read "To start or change a plan, sign in to XBAR in a web browser" -- which
 * is precisely such a direction, written into the very screen whose purpose is
 * not to have one.
 */
test('the native billing panel gives no instruction on where to purchase', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/routes/Subscriptions.tsx'), 'utf8');
  // Comments stripped: the rule above is explained in prose that necessarily
  // quotes the banned phrasing, and matching the raw file would flag it.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  for (const steer of [
    /in a web browser/i,
    /on the web(site)? to (start|change|subscribe)/i,
    /visit .{0,40} to subscribe/i,
  ]) {
    assert.doesNotMatch(code, steer, `the billing screen tells customers where to buy: ${steer}`);
  }
});

/*
 * Configuring only the app URL has to keep a deployment on its own domain.
 *
 * .env.example promises this works. Without deriving the site from the app URL
 * it did not: a custom domain that set only VITE_PUBLIC_APP_URL got the stock
 * production host as its site, so Terms and Privacy left the customer's domain
 * entirely. The runtime fallback could not rescue it, because the build always
 * injects VITE_PUBLIC_SITE_URL and so overwrites the value it would derive.
 */
test('a custom app URL alone still yields a matching site origin', () => {
  const source = readFileSync(path.join(process.cwd(), 'scripts/build-mobile.mjs'), 'utf8');
  assert.match(
    source,
    /configuredAppUrl[\s\S]{0,80}\/app\$\//,
    'the site origin is no longer derived from a configured app URL, so a custom domain gets the default host',
  );
});

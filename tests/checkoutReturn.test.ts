import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CHECKOUT_CONFIRMATION_POLL_INTERVAL_MS,
  CHECKOUT_CONFIRMATION_TIMEOUT_MS,
  isCheckoutConfirmationComplete,
  parseCheckoutReturn,
  stripCheckoutReturnParam,
} from '../src/lib/checkoutReturn.js';
import { subscriptionFromCloudRow } from '../src/lib/cloudSubscription.js';

const repoRoot = process.cwd();

function readRepoFile(filePath: string) {
  return readFileSync(path.join(repoRoot, filePath), 'utf8');
}

test('parseCheckoutReturn recognizes the two values the checkout endpoint writes', () => {
  assert.equal(parseCheckoutReturn('?checkout=success'), 'success');
  assert.equal(parseCheckoutReturn('?checkout=cancelled'), 'cancelled');
});

test('parseCheckoutReturn reads the parameter beside others', () => {
  assert.equal(parseCheckoutReturn('?plan=Professional&checkout=success'), 'success');
  assert.equal(parseCheckoutReturn('?checkout=cancelled&plan=Ranch%20Ops'), 'cancelled');
});

test('parseCheckoutReturn ignores anything that is not a checkout return', () => {
  assert.equal(parseCheckoutReturn(''), null);
  assert.equal(parseCheckoutReturn('?plan=Professional'), null);
  assert.equal(parseCheckoutReturn('?checkout='), null);
  assert.equal(parseCheckoutReturn('?checkout=paid'), null);
  assert.equal(parseCheckoutReturn('?checkout=SUCCESS'), null);
});

test('parseCheckoutReturn tolerates a missing leading question mark', () => {
  assert.equal(parseCheckoutReturn('checkout=success'), 'success');
});

test('stripCheckoutReturnParam removes only the checkout return', () => {
  assert.equal(stripCheckoutReturnParam('?checkout=success'), '');
  assert.equal(stripCheckoutReturnParam('?checkout=cancelled'), '');
  assert.equal(stripCheckoutReturnParam('?plan=Professional&checkout=success'), '?plan=Professional');
  assert.equal(stripCheckoutReturnParam('?checkout=success&plan=Professional'), '?plan=Professional');
  assert.equal(stripCheckoutReturnParam('?plan=Professional'), '?plan=Professional');
  assert.equal(stripCheckoutReturnParam(''), '');
});

test('confirmation polling bounds stay inside the 60-90s window', () => {
  assert.equal(CHECKOUT_CONFIRMATION_POLL_INTERVAL_MS, 5_000);
  assert.ok(
    CHECKOUT_CONFIRMATION_TIMEOUT_MS >= 60_000 && CHECKOUT_CONFIRMATION_TIMEOUT_MS <= 90_000,
    `timeout ${CHECKOUT_CONFIRMATION_TIMEOUT_MS}ms is outside the 60-90s contract`,
  );
});

test('an active paid profile confirms the checkout', () => {
  const profile = subscriptionFromCloudRow({
    tier: 'Professional',
    billing_state: 'Active',
    monthly_rate: 29,
    payload: {},
  });
  assert.ok(profile, 'fixture must map to a profile');
  assert.equal(isCheckoutConfirmationComplete(profile), true);
});

test('a freshly seeded workspace does not confirm a purchase that never happened', () => {
  // A new workspace is seeded Starter / 'Manual Billing' / rate 0. The billing
  // state alone is entitled, so confirmation has to require the rate too —
  // otherwise the very first poll after a real checkout would "confirm" even
  // before Stripe was paid, for every brand-new workspace.
  const seeded = subscriptionFromCloudRow({
    tier: 'Starter',
    billing_state: 'Manual Billing',
    monthly_rate: 0,
    payload: {},
  });
  assert.ok(seeded, 'fixture must map to a profile');
  assert.equal(isCheckoutConfirmationComplete(seeded), false);
});

test('lapsed and past-due profiles do not confirm the checkout', () => {
  const canceled = subscriptionFromCloudRow({
    tier: 'Professional',
    billing_state: 'Inactive',
    monthly_rate: 29,
    payload: {},
  });
  const pastDue = subscriptionFromCloudRow({
    tier: 'Professional',
    billing_state: 'Past Due',
    monthly_rate: 29,
    payload: {},
  });
  assert.ok(canceled && pastDue, 'fixtures must map to profiles');
  assert.equal(isCheckoutConfirmationComplete(canceled), false);
  assert.equal(isCheckoutConfirmationComplete(pastDue), false);
});

test('an unreadable or absent profile is never confirmation', () => {
  assert.equal(isCheckoutConfirmationComplete(null), false);
  assert.equal(isCheckoutConfirmationComplete(undefined), false);
});

test('billing screen reads the checkout return and cleans the URL', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');
  assert.match(source, /parseCheckoutReturn\(window\.location\.search\)/);
  assert.match(source, /stripCheckoutReturnParam\(window\.location\.search\)/);
  assert.match(
    source,
    /window\.history\.replaceState\(null, '', `\$\{window\.location\.pathname\}\$\{cleaned\}\$\{window\.location\.hash\}`\)/,
    'the return parameter must be cleaned with replaceState so refresh cannot re-trigger it',
  );
});

test('billing screen shows a success toast and a confirming state on ?checkout=success', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');
  assert.match(source, /title: 'Payment completed'/);
  assert.match(source, /Confirming your payment/);
  assert.match(source, /role="status"/);
});

test('billing screen polls the cloud profile and activates the plan only when the row says paid', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');
  assert.match(source, /refreshWorkspaceSubscriptionProfile\(workspaceId\)/);
  assert.match(source, /isCheckoutConfirmationComplete\(profile\)/);
  assert.match(source, /useXbarStore\.setState\(\{ subscription: profile \}\)/);
  assert.match(source, /CHECKOUT_CONFIRMATION_TIMEOUT_MS/);
});

test('a checkout the screen cannot confirm yet says "still confirming", never that it failed', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');
  assert.match(source, /still confirming your payment/);
  assert.match(source, /Check back shortly/);
  const staleBlock = source.slice(source.indexOf('still confirming your payment') - 400);
  assert.equal(
    /payment failed/i.test(staleBlock.slice(0, 900)),
    false,
    'the timeout notice must not use failure language',
  );
});

test('billing screen answers ?checkout=cancelled with a quiet dismissible notice', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');
  assert.match(source, /Checkout cancelled — no charge was made\./);
  assert.match(source, /checkout-return-banner--quiet/);
});

test('the cloud subscription refresher reads the canonical profile row', () => {
  const source = readRepoFile('src/lib/cloudWorkspace.ts');
  assert.match(source, /export async function refreshWorkspaceSubscriptionProfile/);
  assert.match(source, /\.from\('workspace_subscription_profiles'\)/);
  assert.match(source, /subscriptionFromCloudRow\(data\)/);
  // A failed read is unknown, not a stale profile: the poll keeps going and
  // never confirms from an error.
  assert.match(source, /if \(error\) \{\s*return \{ ok: false, message: error\.message \};/);
});

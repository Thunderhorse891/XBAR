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
  watchCheckoutConfirmation,
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
    /navigate\(\{ search: cleaned, hash: window\.location\.hash \}, \{ replace: true \}/,
    'cleanup must replace the router location while preserving the path and fragment',
  );
});

test('billing screen verifies a return without claiming that the query string proves payment', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');
  assert.doesNotMatch(source, /Payment completed|Payment received|Your payment went through/);
  assert.match(source, /Confirming your payment/);
  assert.match(source, /role="status"/);
});

test('billing screen polls the cloud profile and activates the plan only when the row says paid', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');
  assert.match(source, /refreshWorkspaceSubscriptionProfile\(workspaceId\)/);
  assert.match(source, /watchCheckoutConfirmation\(\{/);
  assert.match(source, /refreshWorkspaceSubscriptionProfile\(workspaceId, signal\)/);
  assert.match(source, /useXbarStore\.setState\(\{ subscription: profile \}\)/);
});

test('a checkout the screen cannot confirm yet says "still confirming", never that it failed', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');
  assert.match(source, /still confirming your payment/);
  assert.match(source, /Check again/);
  const staleBlock = source.slice(source.indexOf('still confirming your payment') - 400);
  assert.equal(
    /payment failed/i.test(staleBlock.slice(0, 900)),
    false,
    'the timeout notice must not use failure language',
  );
});

test('billing screen answers ?checkout=cancelled with a quiet dismissible notice', () => {
  const source = readRepoFile('src/routes/Subscriptions.tsx');
  assert.match(source, /Checkout cancelled\./);
  assert.doesNotMatch(source, /no charge was made/);
  assert.match(source, /checkout-return-banner--quiet/);
});

const paidProfile = subscriptionFromCloudRow({
  tier: 'Professional',
  billing_state: 'Active',
  monthly_rate: 29,
  payload: {},
})!;

// Flush async reads without advancing the independent timeout.
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

test('confirmation times out and aborts a hung read; a late paid row cannot reverse it', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveRead!: (profile: typeof paidProfile) => void;
  let readSignal: AbortSignal | undefined;
  const confirmed: unknown[] = [];
  let timeouts = 0;
  watchCheckoutConfirmation({
    readProfile: (signal) => {
      readSignal = signal;
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    },
    onConfirmed: (profile) => confirmed.push(profile),
    onTimeout: () => {
      timeouts += 1;
    },
  });
  context.mock.timers.tick(CHECKOUT_CONFIRMATION_TIMEOUT_MS);
  assert.equal(timeouts, 1);
  assert.equal(readSignal?.aborted, true);
  resolveRead(paidProfile);
  await settle();
  context.mock.timers.tick(CHECKOUT_CONFIRMATION_TIMEOUT_MS);
  assert.deepEqual(confirmed, []);
  assert.equal(timeouts, 1);
});

test('a thrown transport error retries and only the later verified profile confirms', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let reads = 0;
  let timeouts = 0;
  const confirmed: unknown[] = [];
  watchCheckoutConfirmation({
    readProfile: async () => {
      if (++reads === 1) throw new Error('Offline');
      return paidProfile;
    },
    onConfirmed: (profile) => confirmed.push(profile),
    onTimeout: () => {
      timeouts += 1;
    },
  });
  await settle();
  assert.deepEqual(confirmed, []);
  context.mock.timers.tick(CHECKOUT_CONFIRMATION_POLL_INTERVAL_MS);
  await settle();
  assert.deepEqual(confirmed, [paidProfile]);
  context.mock.timers.tick(CHECKOUT_CONFIRMATION_TIMEOUT_MS);
  assert.equal(timeouts, 0);
  assert.equal(reads, 2);
});

test('missing and unpaid profiles never confirm; a fresh check can later succeed', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let reads = 0;
  let timeouts = 0;
  const confirmed: unknown[] = [];
  const onConfirmed = (profile: typeof paidProfile) => confirmed.push(profile);
  const onTimeout = () => {
    timeouts += 1;
  };
  watchCheckoutConfirmation({
    readProfile: async () => (++reads === 1 ? null : { ...paidProfile, billingState: 'Past Due' }),
    onConfirmed,
    onTimeout,
  });
  await settle();
  context.mock.timers.tick(CHECKOUT_CONFIRMATION_POLL_INTERVAL_MS);
  await settle();
  context.mock.timers.tick(CHECKOUT_CONFIRMATION_TIMEOUT_MS);
  await settle();
  assert.equal(timeouts, 1);
  assert.deepEqual(confirmed, []);
  watchCheckoutConfirmation({ readProfile: async () => paidProfile, onConfirmed, onTimeout });
  await settle();
  assert.deepEqual(confirmed, [paidProfile]);
});

test('workspace change or unmount cancels the read and discards its late result', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveRead!: (profile: typeof paidProfile) => void;
  let readSignal: AbortSignal | undefined;
  let callbacks = 0;
  const cancel = watchCheckoutConfirmation({
    readProfile: (signal) => {
      readSignal = signal;
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    },
    onConfirmed: () => {
      callbacks += 1;
    },
    onTimeout: () => {
      callbacks += 1;
    },
  });
  cancel();
  assert.equal(readSignal?.aborted, true);
  resolveRead(paidProfile);
  await settle();
  context.mock.timers.tick(CHECKOUT_CONFIRMATION_TIMEOUT_MS);
  assert.equal(callbacks, 0);
});

test('cleanup also cancels a scheduled retry', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let reads = 0;
  const cancel = watchCheckoutConfirmation({
    readProfile: async () => {
      reads += 1;
      return null;
    },
    onConfirmed: () => assert.fail('unexpected confirmation'),
    onTimeout: () => assert.fail('unexpected timeout'),
  });
  await settle();
  cancel();
  context.mock.timers.tick(CHECKOUT_CONFIRMATION_TIMEOUT_MS);
  assert.equal(reads, 1);
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

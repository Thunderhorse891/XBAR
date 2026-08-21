import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BASELINE_TIER,
  BILLING_STATES,
  ENTITLED_STRIPE_STATUSES,
  INACTIVE_STRIPE_STATUSES,
  PAST_DUE_STRIPE_STATUSES,
  billingStateForStripeStatus,
  entitledTierForBillingState,
  isKnownBillingState,
  isRecoverableStripeStatus,
  resolveWebhookTier,
  RECOVERABLE_STRIPE_STATUSES,
  TERMINAL_STRIPE_STATUSES,
} from '../../api/_lib/subscription-status.js';
import { buildSubscriptionProfile, findTierByPriceId, isKnownTier } from '../../api/_lib/subscription-plans.js';

/*
 * What a billing status is allowed to mean.
 *
 * The bug these tests pin: the old mapper ended with `return 'Manual Billing'`,
 * and Manual Billing grants the full paid tier. Every status it did not
 * recognize — canceled, paused, incomplete, a typo, a status Stripe adds next
 * year — therefore landed on the most permissive outcome available. A canceled
 * subscription kept every paid feature, and because `api/stripe/checkout.js`
 * writes a profile with status `incomplete` when a session is *created*,
 * opening the checkout page granted the tier before any money moved.
 */

// Every subscription status Stripe documents, so the table below is a
// statement about the whole API surface rather than the cases we thought of.
const ALL_STRIPE_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'canceled',
  'paused',
];

const EXPECTED_STATE_BY_STATUS = {
  active: 'Active',
  trialing: 'Active',
  past_due: 'Past Due',
  unpaid: 'Inactive',
  incomplete: 'Inactive',
  incomplete_expired: 'Inactive',
  canceled: 'Inactive',
  paused: 'Inactive',
};

// Only these two carry the purchased tier. Everything else drops to baseline.
const STATUSES_KEEPING_PAID_TIER = new Set(['active', 'trialing']);

for (const status of ALL_STRIPE_STATUSES) {
  test(`Stripe status "${status}" maps to ${EXPECTED_STATE_BY_STATUS[status]}`, () => {
    assert.equal(billingStateForStripeStatus(status), EXPECTED_STATE_BY_STATUS[status]);
  });

  test(`Stripe status "${status}" ${STATUSES_KEEPING_PAID_TIER.has(status) ? 'keeps' : 'drops'} the paid tier`, () => {
    const state = billingStateForStripeStatus(status);
    const entitled = entitledTierForBillingState('Enterprise', state);

    if (STATUSES_KEEPING_PAID_TIER.has(status)) {
      assert.equal(entitled, 'Enterprise');
    } else {
      assert.equal(entitled, BASELINE_TIER, `"${status}" must not carry Enterprise entitlements`);
    }
  });
}

test('the documented status lists agree with the resolver', () => {
  for (const status of ENTITLED_STRIPE_STATUSES) {
    assert.equal(billingStateForStripeStatus(status), 'Active');
  }
  for (const status of PAST_DUE_STRIPE_STATUSES) {
    assert.equal(billingStateForStripeStatus(status), 'Past Due');
  }
  for (const status of INACTIVE_STRIPE_STATUSES) {
    assert.equal(billingStateForStripeStatus(status), 'Inactive');
  }
});

test('no status can produce Manual Billing', () => {
  // This is the rule the whole module rests on: Manual Billing grants the paid
  // tier, so it must be an operator decision, never something a payment
  // processor's string can reach by accident.
  const candidates = [
    ...ALL_STRIPE_STATUSES,
    'Manual Billing',
    'manual',
    'manual_billing',
    '',
    '   ',
    'ACTIVE_BUT_NOT_REALLY',
    'some_status_stripe_adds_in_2027',
    null,
    undefined,
    0,
    {},
  ];

  for (const candidate of candidates) {
    assert.notEqual(
      billingStateForStripeStatus(candidate),
      'Manual Billing',
      `${String(candidate)} must not resolve to Manual Billing`,
    );
  }
});

test('an unknown status is inactive, not entitled', () => {
  const state = billingStateForStripeStatus('some_status_stripe_adds_in_2027');
  assert.equal(state, 'Inactive');
  assert.equal(entitledTierForBillingState('Ranch Ops', state), BASELINE_TIER);
});

test('status casing and padding do not change the outcome', () => {
  assert.equal(billingStateForStripeStatus('  ACTIVE '), 'Active');
  assert.equal(billingStateForStripeStatus('Canceled'), 'Inactive');
});

test('Manual Billing keeps the tier, but only when stored deliberately', () => {
  // The one state that grants a paid tier without Stripe. Safe only because
  // nothing above can return it.
  assert.equal(entitledTierForBillingState('Enterprise', 'Manual Billing'), 'Enterprise');
});

test('an unrecognized stored billing state is not entitled', () => {
  for (const stored of ['', 'manual billing', 'Comped', 'unknown', null, undefined]) {
    assert.equal(
      entitledTierForBillingState('Enterprise', stored),
      BASELINE_TIER,
      `stored state ${String(stored)} must not grant Enterprise`,
    );
    assert.equal(isKnownBillingState(stored), false);
  }
});

test('Past Due keeps the account but not the paid feature set', () => {
  assert.equal(entitledTierForBillingState('Ranch Ops', 'Past Due'), BASELINE_TIER);
  assert.ok(BILLING_STATES.includes('Past Due'));
});

test('an unknown tier resolves to baseline and reports that it was not recognized', () => {
  const profile = buildSubscriptionProfile({ tier: 'Platinum Deluxe', billingStatus: 'active' });

  assert.equal(profile.tier, BASELINE_TIER);
  assert.equal(profile.tierRecognized, false, 'a discarded tier must be visible, not silently rewritten');
  assert.equal(isKnownTier('Platinum Deluxe'), false);

  const known = buildSubscriptionProfile({ tier: 'Professional', billingStatus: 'active' });
  assert.equal(known.tier, 'Professional');
  assert.equal(known.tierRecognized, true);
});

test('a profile built from a canceled subscription is not entitled', () => {
  // End to end through the builder, which is what the webhook actually writes.
  const profile = buildSubscriptionProfile({ tier: 'Enterprise', billingStatus: 'canceled' });
  assert.equal(profile.billingState, 'Inactive');
  assert.equal(entitledTierForBillingState(profile.tier, profile.billingState), BASELINE_TIER);
});

test('creating a checkout session does not grant the tier', () => {
  // api/stripe/checkout.js writes this payload when the session is created,
  // before the customer has paid anything.
  const profile = buildSubscriptionProfile({ tier: 'Enterprise', billingStatus: 'incomplete' });
  assert.equal(profile.billingState, 'Inactive');
  assert.equal(entitledTierForBillingState(profile.tier, profile.billingState), BASELINE_TIER);
});

test('an unknown price id resolves to no tier rather than Starter', () => {
  const priceEnvKeys = [
    'STRIPE_PRICE_ID_STARTER',
    'STRIPE_PRICE_ID_PROFESSIONAL',
    'STRIPE_PRICE_ID_RANCH_OPS',
    'STRIPE_PRICE_ID_ENTERPRISE',
  ];
  const saved = Object.fromEntries(priceEnvKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.STRIPE_PRICE_ID_STARTER = 'price_starter';
    process.env.STRIPE_PRICE_ID_PROFESSIONAL = 'price_pro';
    process.env.STRIPE_PRICE_ID_RANCH_OPS = 'price_ranch';
    process.env.STRIPE_PRICE_ID_ENTERPRISE = 'price_ent';

    assert.equal(findTierByPriceId('price_pro'), 'Professional');

    // The webhook used to do `findTierByPriceId(priceId) || 'Starter'`, which
    // silently downgraded a paying customer whenever the price env vars were
    // misconfigured. null is what lets the caller refuse instead of guess.
    assert.equal(findTierByPriceId('price_that_does_not_exist'), null);
  } finally {
    for (const key of priceEnvKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test('an empty price id matches nothing even when price env vars are unset', () => {
  const priceEnvKeys = [
    'STRIPE_PRICE_ID_STARTER',
    'STRIPE_PRICE_ID_PROFESSIONAL',
    'STRIPE_PRICE_ID_RANCH_OPS',
    'STRIPE_PRICE_ID_ENTERPRISE',
  ];
  const saved = Object.fromEntries(priceEnvKeys.map((key) => [key, process.env[key]]));

  try {
    // The state an unconfigured deployment is actually in. Without the
    // empty-string guard every tier's configured id is '' too, so '' would
    // match the first tier and an unknown price would resolve to a real plan.
    for (const key of priceEnvKeys) delete process.env[key];

    assert.equal(findTierByPriceId(''), null);
    assert.equal(findTierByPriceId(undefined), null);
    assert.equal(findTierByPriceId('price_anything'), null);
  } finally {
    for (const key of priceEnvKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

/*
 * A cancellation must be recordable even when its price id cannot be mapped.
 *
 * The webhook refused any event whose price id had no STRIPE_PRICE_ID_* match,
 * before touching the profile. That is right for an event that grants access
 * and wrong for one that withdraws it: a subscription canceled after its price
 * was retired, or while the env var was briefly misconfigured, was rejected —
 * so the previous Active record stayed in place, every entitlement check kept
 * granting the old paid tier, and Stripe's retries could not fix it because
 * they hit the same rejection.
 */

test('an entitling status with an unmappable price id refuses rather than guessing', () => {
  for (const status of ENTITLED_STRIPE_STATUSES) {
    const decision = resolveWebhookTier({ status, mappedTier: null, storedTier: 'Enterprise' });
    assert.equal(decision.ok, false, `${status} must not write an entitlement from an unknown price`);
    assert.equal(decision.tier, undefined, 'a refused decision must not carry a tier to write');
  }
});

test('a non-entitling status is recorded against the stored tier when its price is unmappable', () => {
  for (const status of [...INACTIVE_STRIPE_STATUSES, ...PAST_DUE_STRIPE_STATUSES]) {
    const decision = resolveWebhookTier({ status, mappedTier: null, storedTier: 'Ranch Ops' });

    assert.equal(decision.ok, true, `${status} must still be recorded without a price mapping`);
    // The stored tier is carried forward as the thing being lost; the billing
    // state is what removes the access, via entitledTierForBillingState.
    assert.equal(decision.tier, 'Ranch Ops');
    assert.equal(entitledTierForBillingState(decision.tier, decision.billingState), BASELINE_TIER);
  }
});

test('an unknown status with an unmappable price id is recorded as inactive, not skipped', () => {
  const decision = resolveWebhookTier({ status: 'some_future_status', mappedTier: null, storedTier: 'Professional' });

  assert.equal(decision.ok, true);
  assert.equal(decision.billingState, 'Inactive');
  assert.equal(entitledTierForBillingState(decision.tier, decision.billingState), BASELINE_TIER);
});

test('a cancellation for a workspace with no stored tier falls back to the baseline', () => {
  for (const storedTier of [null, undefined, '']) {
    const decision = resolveWebhookTier({ status: 'canceled', mappedTier: null, storedTier });
    assert.equal(decision.ok, true);
    assert.equal(decision.tier, BASELINE_TIER);
  }
});

test('a mapped price id always wins, for every status', () => {
  for (const status of [
    ...ENTITLED_STRIPE_STATUSES,
    ...PAST_DUE_STRIPE_STATUSES,
    ...INACTIVE_STRIPE_STATUSES,
    'nonsense',
  ]) {
    const decision = resolveWebhookTier({ status, mappedTier: 'Professional', storedTier: 'Enterprise' });
    assert.equal(decision.ok, true);
    assert.equal(decision.tier, 'Professional', `${status} should record the tier the event's price maps to`);
    assert.equal(decision.billingState, billingStateForStripeStatus(status));
  }
});

/*
 * The stored payload is what the client gates on, so it must not carry paid
 * entitlements the billing state does not support.
 *
 * The client loads this payload verbatim, and its gates read `tier`,
 * `sharedAccessEnabled` and the usage limits — none of them consult
 * billingState. Copying the purchased tier's values in therefore left a
 * canceled Enterprise workspace rendering paid features and passing every local
 * gate, while the API and the database both enforced Starter.
 */

test('a lapsed subscription stores baseline entitlements, not the ones it bought', () => {
  for (const status of [...INACTIVE_STRIPE_STATUSES, ...PAST_DUE_STRIPE_STATUSES, 'some_future_status']) {
    const profile = buildSubscriptionProfile({ tier: 'Enterprise', billingStatus: status });
    const baseline = buildSubscriptionProfile({ tier: BASELINE_TIER, billingStatus: 'active' });

    assert.equal(profile.tier, BASELINE_TIER, `${status} must not leave Enterprise in the gated tier field`);
    assert.equal(profile.sharedAccessEnabled, baseline.sharedAccessEnabled);
    assert.deepEqual(profile.featureFlags, baseline.featureFlags);

    for (const limit of [
      'horseLimit',
      'seatLimit',
      'documentLimit',
      'salePacketLimit',
      'storageLimitGb',
      'sharedAccessSeatLimit',
    ]) {
      assert.equal(profile.usage[limit], baseline.usage[limit], `${status} leaked the paid ${limit}`);
    }

    // What was bought is kept, so a billing screen can name the lapsed plan —
    // but it is not the field anything gates on.
    assert.equal(profile.purchasedTier, 'Enterprise');
  }
});

test('an entitled subscription keeps everything it paid for', () => {
  for (const status of ENTITLED_STRIPE_STATUSES) {
    const profile = buildSubscriptionProfile({ tier: 'Enterprise', billingStatus: status });

    assert.equal(profile.tier, 'Enterprise');
    assert.equal(profile.purchasedTier, 'Enterprise');
    assert.equal(profile.sharedAccessEnabled, true);
    assert.equal(profile.usage.horseLimit, 2000);
  }
});

test('the quoted rate stays that of the plan that was bought', () => {
  // Falling back to Starter's rate would imply a charge that is not happening;
  // billingState is what says whether anything is being billed.
  const canceled = buildSubscriptionProfile({ tier: 'Enterprise', billingStatus: 'canceled' });
  const active = buildSubscriptionProfile({ tier: 'Enterprise', billingStatus: 'active' });

  assert.equal(canceled.monthlyRate, active.monthlyRate);
  assert.equal(canceled.billingState, 'Inactive');
});

/*
 * The webhook's stored-tier fallback must not be reached by a failed read.
 *
 * resolveWebhookTier falls back to the baseline when there is no stored tier,
 * which is correct for a workspace that never subscribed. If the lookup merely
 * errored, that fallback rewrites a canceled Professional or Enterprise
 * subscription as Starter — losing the purchased tier and its rate permanently
 * instead of marking it inactive. Discarding the error is what makes the two
 * cases indistinguishable, and it is the same defect this policy module exists
 * to remove, so it is guarded at the call site.
 */
test('the webhook does not treat a failed profile lookup as an absent profile', async () => {
  const source = await readFile(path.join(process.cwd(), 'api/stripe/webhook.js'), 'utf8');

  assert.match(
    source,
    /const \{ data: existingProfile, error: existingProfileError \} = await supabase/,
    'the profile lookup must capture its error, not discard it',
  );

  // Order matters: the guard has to run before the fallback that consumes the
  // stored tier, or the destructured error is captured and still ignored.
  const guard = source.indexOf('if (existingProfileError)');
  const fallback = source.indexOf('resolveWebhookTier(');
  assert.notEqual(guard, -1, 'the captured error must actually be acted on');
  assert.ok(guard < fallback, 'the error must be handled before the stored tier is used');
});

/*
 * Entitlement and billability are different questions, and one state cannot
 * answer both.
 *
 * `paused` and `unpaid` map to 'Inactive' — correctly, they carry no paid
 * access — but Stripe keeps their subscription: a paused one resumes once
 * payment details are added, and an unpaid one's invoices can be reopened and
 * paid (node_modules/stripe/types/Subscriptions.d.ts). The billing screen read
 * `billingState === 'Past Due'` to decide whether to offer checkout, so those
 * two got enabled plan buttons and could open a SECOND `mode: 'subscription'`
 * session beside the live one — duplicate billing, with two streams of webhooks
 * fighting over one entitlement row.
 */
test('recoverable is not the same question as entitled', () => {
  // The exact overlap that made the old guard wrong: not entitled, yet still
  // billable. Neither state alone identifies these.
  for (const status of ['unpaid', 'paused']) {
    assert.equal(billingStateForStripeStatus(status), 'Inactive', `${status} grants nothing`);
    assert.equal(isRecoverableStripeStatus(status), true, `${status} can still bill`);
  }

  // And the reverse: entitled, so there is nothing to recover.
  for (const status of ENTITLED_STRIPE_STATUSES) {
    assert.equal(isRecoverableStripeStatus(status), false);
  }
});

test('every recoverable status is flagged on the profile, and terminal ones are not', () => {
  for (const status of RECOVERABLE_STRIPE_STATUSES) {
    const profile = buildSubscriptionProfile({ tier: 'Enterprise', billingStatus: status });
    assert.equal(profile.subscriptionRecoverable, true, `${status} leaves a billable subscription`);
  }

  // Terminal subscriptions cannot be revived, so buying again is correct —
  // otherwise a canceled customer could never come back.
  for (const status of TERMINAL_STRIPE_STATUSES) {
    const profile = buildSubscriptionProfile({ tier: 'Enterprise', billingStatus: status });
    assert.equal(profile.subscriptionRecoverable, false, `${status} is over`);
  }

  // No status at all means no Stripe subscription — every new workspace. These
  // must be able to purchase.
  for (const absent of ['', '   ', null, undefined]) {
    const profile = buildSubscriptionProfile({ tier: 'Starter', billingStatus: absent });
    assert.equal(profile.subscriptionRecoverable, false, 'a workspace with no subscription can buy');
  }
});

/*
 * The two policies fail in opposite directions, on purpose.
 *
 * Entitlement fails closed: the risk is granting access nobody paid for.
 * Billability fails toward withholding checkout: the risk is charging a
 * customer twice. A wrongly withheld purchase costs a support message; a
 * duplicate subscription takes money and needs a refund.
 */
test('an unrecognized status is unentitled and treated as still billable', () => {
  for (const status of ['some_future_status', 'ACTIVE_BUT_NOT_REALLY', 'null']) {
    assert.equal(billingStateForStripeStatus(status), 'Inactive', `${status} must not entitle`);
    assert.equal(isRecoverableStripeStatus(status), true, `${status} must not offer checkout`);
  }
});

/*
 * The screen must read the flag, not re-derive it.
 *
 * Asserted by shape rather than at the one call site the review named: the
 * value was passed to getCheckoutReadiness from three places in this file, and
 * fixing the named one is exactly how the other two would have survived.
 */
test('the billing screen reads the profile flag rather than testing Past Due', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/routes/Subscriptions.tsx'), 'utf8');

  assert.match(source, /const subscriptionRecoverable = subscription\.subscriptionRecoverable === true;/);

  // The retired derivation must not come back anywhere in the file, in any
  // form that feeds the checkout guard.
  assert.doesNotMatch(source, /billingState === 'Past Due'/);

  // Every call into the readiness helper carries the flag. A call that omits it
  // silently reverts to offering checkout on a recoverable subscription.
  const calls = source.match(/getCheckoutReadiness\(\{[\s\S]*?\}\)/g) || [];
  assert.ok(calls.length >= 3, `expected the three readiness call sites, found ${calls.length}`);
  for (const call of calls) {
    assert.match(call, /subscriptionRecoverable/, `a getCheckoutReadiness call omits the guard:\n${call}`);
  }
});

/*
 * The Reports screen must gate profit intelligence like every other screen.
 *
 * `commercialEngine.ts` assigns profitIntelligence to Ranch Ops, and
 * Financials and Expenses have gated it all along. Surfacing cost, break-even,
 * margin and spend trends on Reports without the same gate made that screen a
 * way around the paywall — and the PDF/CSV exports made it a way around the
 * paywall in a file you could keep and pass on.
 *
 * Asserted against the source because this suite has no DOM. What it checks is
 * the shape that matters: the gate is consulted, it is fed the EFFECTIVE
 * subscription so owner preview still works, and neither export can run while
 * locked.
 */
test('the reports screen gates profit intelligence behind the same feature check', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/routes/Reports.tsx'), 'utf8');

  assert.match(source, /profitIntelligenceGate/, 'the screen must consult the gate');

  // Effective, not real. A screen that gates a feature reads the preview, so an
  // allowlisted owner previewing Ranch Ops sees what a Ranch Ops customer sees.
  assert.match(source, /const subscription = useEffectiveSubscription\(\);/);
  assert.match(source, /const locked = profitIntelligenceGate\(subscription\);/);

  // Both exports refuse on their own rather than trusting a disabled button.
  // The export IS the paid capability — a file that leaves the app is the thing
  // being gated, so the check belongs in the handler.
  for (const handler of ['handlePdf', 'handleCsv']) {
    const start = source.indexOf(`const ${handler} =`);
    assert.notEqual(start, -1, `${handler} must exist`);
    const body = source.slice(start, start + 400);
    assert.match(body, /if \(locked\) return;/, `${handler} must refuse while locked`);
  }
});

/*
 * A workspace with receipts but no horses still has a report.
 *
 * Keying the empty state on horses alone hid every logged receipt from an
 * operation that recorded general ranch spend before adding its first horse,
 * and took both exports with it — even though buildRanchReport totals receipts
 * that are not tied to a horse and renders fine with an empty roster.
 * Financials.tsx already had the right condition.
 */
test('the reports empty state requires that there be nothing at all to report', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/routes/Reports.tsx'), 'utf8');

  assert.match(
    source,
    /horses\.length === 0 && expenseReceipts\.length === 0 && salesLeads\.length === 0/,
    'the empty state must consider receipts and offers, not only horses',
  );
});

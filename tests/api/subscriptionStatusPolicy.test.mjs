import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASELINE_TIER,
  BILLING_STATES,
  ENTITLED_STRIPE_STATUSES,
  INACTIVE_STRIPE_STATUSES,
  PAST_DUE_STRIPE_STATUSES,
  billingStateForStripeStatus,
  entitledTierForBillingState,
  isKnownBillingState,
  resolveWebhookTier,
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

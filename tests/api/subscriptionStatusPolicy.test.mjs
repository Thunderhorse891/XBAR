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

  // Resolved through the policy helper, not read off the profile. Reading the
  // raw field treats an absent value as "no live subscription", which is wrong
  // for every legacy 'Past Due' row on an upgraded deployment — the previous
  // mapper stored past_due, unpaid and incomplete_expired all as 'Past Due'.
  assert.match(source, /const subscriptionRecoverable = isSubscriptionRecoverable\(subscription\);/);
  assert.doesNotMatch(
    source,
    /subscription\.subscriptionRecoverable === true/,
    'the raw field must not be read directly; the fallback lives in the helper',
  );

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

  // Every slice the report can render from. Asserted as a set rather than as a
  // literal expression, so the check does not care about ordering or
  // formatting — only that nothing reportable is missing from it.
  const guard = source.slice(
    source.indexOf('Only truly empty'),
    source.indexOf('return (', source.indexOf('Only truly empty')),
  );
  for (const slice of ['horses', 'expenseReceipts', 'salesLeads', 'documents']) {
    assert.match(guard, new RegExp(`${slice}\\.length === 0`), `the empty state must consider ${slice}`);
  }
});

/*
 * The runbook has to name every setting the migration reads.
 *
 * This is the shape that has cost the most rounds on this PR: a setting
 * documented where nobody looks, and absent from the command people actually
 * copy. An operator following the README verbatim would never set
 * xbar.reconcile_terminal, so every reconciled row would be written recoverable
 * — and a canceled subscription sends no further webhook to correct it, so
 * those customers would be blocked from resubscribing indefinitely.
 */
test('the runbook sets every reconciliation variable the migration reads', async () => {
  const readme = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');
  const migration = await readFile(
    path.join(process.cwd(), 'supabase/migrations/20260821_reconcile_legacy_manual_billing.sql'),
    'utf8',
  );

  // Driven from the migration rather than from a list written here, so a
  // setting added later is covered without anyone remembering to add it.
  const settings = [...migration.matchAll(/current_setting\('(xbar\.[a-z_]+)', true\)/g)].map((match) => match[1]);
  assert.ok(settings.length >= 3, `expected the migration to read several settings, found ${settings.length}`);

  for (const setting of [...new Set(settings)]) {
    assert.match(readme, new RegExp(`set ${setting.replace('.', '\\.')} = `), `the runbook must set ${setting}`);
    assert.match(readme, new RegExp(`reset ${setting.replace('.', '\\.')}`), `the runbook must reset ${setting}`);
  }
});

/*
 * The runbook must not point comps at the email allowlist.
 *
 * The migration states plainly that XBAR_COMP_EMAILS cannot replace a
 * deliberate 'Manual Billing' grant: it is keyed on email, always grants
 * Enterprise, and is applied by the API, so the database limit triggers never
 * see it. A workspace comped that way reports Enterprise while its seat,
 * storage and commercial writes are refused at the stored tier — the exact
 * API/database split this PR exists to close.
 */
test('the runbook does not recommend the email allowlist as a comp mechanism', async () => {
  const readme = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.doesNotMatch(
    readme,
    /comp an account with `XBAR_COMP_EMAILS`/,
    'the allowlist is invisible to the database limit triggers',
  );

  // It may still be described — it is a real variable — but the description
  // has to carry the limitation.
  if (readme.includes('XBAR_COMP_EMAILS')) {
    assert.match(readme, /database limit triggers[\s\S]{0,120}never\s+see it/);
  }
});

/*
 * A caption must not contradict the model it is captioning.
 *
 * buildRanchReport deliberately excludes purchase prices from
 * investedThisMonth — a purchase carries no date, so attributing it to a month
 * would file a horse bought two years ago under whenever the report was run.
 * The "Spent this month" card then rendered the lifetime acquisition total as
 * its detail line, producing "$100 spent this month · $10,000 of that is
 * purchase prices": two figures from different periods, presented as parts of
 * one.
 */
test('the spent-this-month card does not caption itself with lifetime purchases', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/routes/Reports.tsx'), 'utf8');

  const start = source.indexOf('label="Spent this month"');
  assert.notEqual(start, -1, 'the card must exist');
  const card = source.slice(start, source.indexOf('/>', start));

  assert.match(card, /value=\{formatCompactCurrency\(report\.money\.investedThisMonth\)\}/);
  assert.ok(!/detail=.*acquisitionCost/.test(card), 'a lifetime acquisition total is not part of this month spend');
});

/*
 * The ordering rule lives in SQL, and in only one place.
 *
 * It was first written as a JavaScript predicate called before three separate
 * upserts. That is a read-modify-write with no serialization, and Stripe
 * delivers concurrently: an older `updated` being retried and the `deleted`
 * that superseded it can both read the same previous timestamp, both decide
 * they are newest, and the older one write `Active` over the cancellation —
 * after which both are logged as processed and no retry ever corrects it.
 *
 * Making the write atomic forces the comparison into the same transaction as
 * the writes, so the predicate moved into `xbar_apply_subscription_event`. The
 * JavaScript copy was deleted rather than kept as a fast path: it would have
 * been a second implementation of one invariant, free to drift from the one
 * that actually decides, and it added a round trip rather than saving one.
 */
test('the entitlement write is atomic, not a read followed by upserts', async () => {
  const webhook = await readFile(path.join(process.cwd(), 'api/stripe/webhook.js'), 'utf8');
  const code = webhook.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.match(code, /supabase\.rpc\('xbar_apply_subscription_event', \{/);
  assert.doesNotMatch(
    code,
    /from\('workspace_subscription_profiles'\)\s*\.upsert/,
    'the entitlement upserts must happen inside the locked function, not beside it',
  );
  assert.doesNotMatch(code, /from\('workspace_billing_customers'\)\s*\.upsert/);
  assert.doesNotMatch(code, /from\('workspace_subscription_events'\)\s*\.upsert/);
  assert.doesNotMatch(
    code,
    /order\('stripe_event_created_at'/,
    'and the ordering read must not survive outside the lock, where it proves nothing',
  );

  /*
   * One implementation of the rule. A JavaScript copy could only drift from the
   * one that actually decides.
   */
  const policy = await readFile(path.join(process.cwd(), 'api/_lib/subscription-status.js'), 'utf8');
  assert.doesNotMatch(policy, /isStaleBillingEvent/, 'the duplicate predicate must be gone');

  /*
   * The tier decision stays in JavaScript because it needs the
   * STRIPE_PRICE_ID_* mapping, which is environment rather than schema — so the
   * resolved tier and profile are passed in.
   */
  assert.match(code, /p_tier: tier,/);
  assert.match(code, /p_profile: nextProfile,/);
  assert.match(code, /resolveWebhookTier\(\{/);

  // Both entry points still route through the shared sync.
  assert.equal(
    (code.match(/eventCreatedAt: event\.created \* 1000/g) ?? []).length,
    2,
    'both call sites must pass Stripe’s creation time',
  );
});

test('the apply function serializes per workspace and compares Stripe’s clock', async () => {
  const sql = await readFile(
    path.join(process.cwd(), 'supabase/migrations/20260827_subscription_event_ordering.sql'),
    'utf8',
  );
  const statements = sql.replace(/--[^\n]*/g, '');

  /*
   * An advisory lock rather than `select ... for update`: there is no row to
   * lock on a workspace whose first billing event this is, which is exactly
   * when `workspace_billing_customers` is empty.
   */
  assert.match(statements, /perform pg_advisory_xact_lock\(hashtextextended\(p_workspace_id::text, 0\)\)/);

  const fn = statements.slice(statements.indexOf('create or replace function public.xbar_apply_subscription_event'));
  const lockAt = fn.indexOf('pg_advisory_xact_lock');
  const readAt = fn.indexOf('select max(stripe_event_created_at)');
  const firstWrite = fn.indexOf('insert into public.workspace_subscription_profiles');
  assert.ok(lockAt >= 0 && readAt > lockAt, 'the comparison must happen under the lock, or it races');
  assert.ok(firstWrite > readAt, 'and the writes must follow it inside the same transaction');

  /*
   * STRICTLY older, and null-tolerant on both sides. Several events share a
   * `created` second — a plan change emits more than one — so refusing an equal
   * timestamp would drop a real update, and a workspace whose first event this
   * is must still be able to apply it.
   */
  assert.match(statements, /p_event_created_at < last_applied/);
  assert.doesNotMatch(statements, /p_event_created_at <= last_applied/, 'equal timestamps must both apply');
  assert.match(statements, /last_applied is not null\s*and p_event_created_at is not null/);

  /*
   * The checkout lock lives on `workspace_billing_customers` too. A webhook
   * landing mid-checkout must not clear it, or a second Checkout Session can be
   * created for the same workspace.
   */
  const customerUpsert = statements.slice(
    statements.indexOf('insert into public.workspace_billing_customers'),
    statements.indexOf('insert into public.workspace_subscription_events'),
  );
  assert.doesNotMatch(customerUpsert, /checkout_lock/, 'the webhook must not touch the checkout lock columns');

  // Same rule as 20260822: entitlement writes are service_role only.
  assert.match(
    statements,
    /grant execute on function public\.xbar_apply_subscription_event\([\s\S]*?\) to service_role/,
  );
  assert.match(statements, /revoke all on function public\.xbar_apply_subscription_event\([\s\S]*?\) from anon/);
});

test('the ordering column has a migration, and it does not backfill', async () => {
  const sql = await readFile(
    path.join(process.cwd(), 'supabase/migrations/20260827_subscription_event_ordering.sql'),
    'utf8',
  );
  const statements = sql.replace(/--[^\n]*/g, '');

  assert.match(statements, /add column if not exists stripe_event_created_at timestamptz/);
  assert.match(statements, /workspace_subscription_events \(workspace_id, stripe_event_created_at desc\)/);

  /*
   * No backfill, deliberately: there is no honest value for rows written before
   * the column existed, and `processed_at` is precisely the clock that ordering
   * by it gets wrong. NULL is truthful, and the handler treats an unknown
   * last-applied time as "not stale".
   */
  assert.doesNotMatch(
    statements,
    /update public\.workspace_subscription_events/,
    'a guessed backfill is worse than null',
  );
  assert.doesNotMatch(
    statements,
    /stripe_event_created_at\s*=\s*processed_at/,
    'and the delivery clock is not a stand-in for Stripe’s',
  );
});

test('an update event is a trigger to look, not the authority on status', async () => {
  const webhook = await readFile(path.join(process.cwd(), 'api/stripe/webhook.js'), 'utf8');
  const code = webhook.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /*
   * Timestamps cannot break a tie, and ties happen: a plan change and the
   * cancellation that follows it can share an `event.created` second, and
   * `event.created` carries no sub-second component to separate them. If the
   * cancellation is delivered first and the superseded update arrives after,
   * the strictly-older comparison lets the update through and it restores
   * `Active`. The advisory lock serializes the writes; it cannot say which of
   * two identical timestamps came first, because nothing in the data does.
   *
   * So the status is re-read from Stripe when the event is handled, and a
   * retried update writes the current truth rather than its own snapshot.
   */
  const branch = code.slice(code.indexOf("if (event.type === 'customer.subscription.updated'"));
  assert.match(
    branch,
    /if \(event\.type === 'customer\.subscription\.updated' && payload\.id\) \{\s*effective = await stripe\.subscriptions\.retrieve\(payload\.id\);/,
    'an updated event must resolve the subscription rather than trust its payload',
  );
  assert.match(branch, /status: effective\.status,/, 'and the resolved status is what gets written');
  assert.doesNotMatch(branch, /status: payload\.status,/, 'never the event snapshot');

  /*
   * `deleted` keeps its payload, deliberately. A deleted subscription cannot
   * become active again under the same id, so the event is already final for
   * it — and retrieving one Stripe has finished purging would fail and strand
   * a cancellation unapplied, which is the one direction that must never be
   * lost.
   */
  assert.doesNotMatch(
    branch,
    /customer\.subscription\.deleted'\s*&&\s*payload\.id\) \{\s*effective = await stripe/,
    'a cancellation must not depend on a retrieve that can fail',
  );
  assert.match(branch, /let effective = payload;/, 'which is what the default preserves');

  // The price and seat count come from the same resolved object, or the tier
  // would be read off a snapshot the status no longer agrees with.
  assert.match(branch, /const effectiveLineItem = effective\.items\?\.data\?\.\[0\] \?\? lineItem;/);
  assert.match(branch, /priceId: effectiveLineItem\?\.price\?\.id \|\| '',/);
});

test('a tied event may remove entitlement but never restore it', async () => {
  const statements = await readFile('supabase/migrations/20260827_subscription_event_ordering.sql', 'utf8');
  const fn = statements.slice(statements.indexOf('create or replace function public.xbar_apply_subscription_event'));

  /*
   * Admitting equal timestamps is right for a plan change, and it left one
   * shape unresolved. Two subscriptions on the same customer canceled in the
   * same `created` second: each handler asks Stripe whether a sibling still
   * pays, and that list is read BEFORE the advisory lock, so it can already be
   * stale. The first cancellation carries an `Active` snapshot of a sibling
   * that is itself being canceled — and if the sibling's own `Inactive` landed
   * first, the tie let the stale `Active` overwrite it. Both cancellations were
   * then recorded, so no later event necessarily corrects it and the workspace
   * keeps paid access indefinitely.
   */
  const tieAt = fn.indexOf('p_event_created_at = last_applied');
  assert.ok(tieAt > -1, 'a tie must be recognised, not merely admitted');

  const tieRule = fn.slice(tieAt, fn.indexOf('insert into public.workspace_subscription_profiles', tieAt));
  assert.match(tieRule, /p_billing_state in \('Active', 'Manual Billing'\)/, 'only an ENTITLING tie is questioned');
  assert.match(
    tieRule,
    /current_state not in \('Active', 'Manual Billing'\)/,
    'and only when the state it would overwrite is non-entitling',
  );
  assert.match(tieRule, /return false;/, 'such a write must be refused');

  /*
   * The read has to be under the lock, or the check races exactly as the bug
   * it fixes does.
   */
  assert.ok(fn.indexOf('pg_advisory_xact_lock') < tieAt, 'the tie check must happen under the lock');

  /*
   * The over-rejection direction, and it is the one that would cost a paying
   * customer. A tie must still ADMIT a deactivation, and a strictly-newer
   * entitling event must be unaffected — the rule reads only on an exact tie,
   * so it cannot become a blanket refusal of activations.
   */
  assert.doesNotMatch(tieRule, /p_event_created_at >= last_applied/, 'newer events must not be caught by this');
  assert.doesNotMatch(tieRule, /p_billing_state not in/, 'a tied deactivation must still apply');
  assert.match(statements, /p_event_created_at < last_applied/, 'the strictly-older rule stays');
  assert.doesNotMatch(statements, /p_event_created_at <= last_applied/, 'ties are still admitted in general');
});

test('the entitling states in the tie rule match the entitlement policy', async () => {
  /*
   * Two copies of "which states pay" is how `Inactive` became a hole in the
   * SQL limit helpers earlier on this PR. Derive the list rather than restate
   * it, so adding a billing state to the policy fails here.
   */
  const statements = await readFile('supabase/migrations/20260827_subscription_event_ordering.sql', 'utf8');
  const entitling = BILLING_STATES.filter(
    (state) => entitledTierForBillingState('Enterprise', state) !== BASELINE_TIER,
  );
  const withheld = BILLING_STATES.filter((state) => entitledTierForBillingState('Enterprise', state) === BASELINE_TIER);
  assert.ok(entitling.length > 0 && withheld.length > 0, 'precondition: both sides of the policy are populated');

  const tieAt = statements.indexOf('p_event_created_at = last_applied');
  const tieRule = statements.slice(
    tieAt,
    statements.indexOf('insert into public.workspace_subscription_profiles', tieAt),
  );

  for (const state of entitling) {
    assert.ok(
      tieRule.includes(`'${state}'`),
      `${state} entitles a workspace, so the tie rule must count it as entitling on both sides of its test`,
    );
  }
  for (const state of withheld) {
    assert.ok(
      !tieRule.includes(`'${state}'`),
      `${state} does not entitle — naming it here would protect the wrong side of the tie`,
    );
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getBillingPortalAction,
  getCheckoutReadiness,
  clampSubscriptionToEntitlement,
  isSubscriptionRecoverable,
  normalizeTier,
  hasActivePaidPlan,
  isCurrentPaidPlan,
  isEntitledBillingState,
  planOutcomes,
  recommendedTier,
} from '../src/lib/subscriptionDecision.js';
import type { SubscriptionProfile, SubscriptionTier } from '../src/types/xbar.js';
import { subscriptionPlans } from '../src/lib/subscriptionPlans.js';
import {
  claimPendingHostedPurchase,
  isPendingHostedPurchase,
  migratePendingHostedPurchase,
  parsePendingHostedPurchase,
  pendingHostedPurchaseKey,
  pendingHostedPurchaseNotice,
  readPendingHostedPurchase,
  withPendingPurchaseLock,
} from '../src/lib/pendingHostedPurchase.js';
import type { PendingHostedPurchase } from '../src/lib/pendingHostedPurchase.js';

test('hosted payment links keep checkout available when managed billing is paused', () => {
  const result = getCheckoutReadiness({
    billingEnabled: false,
    canManageBilling: true,
    hasManagedIdentity: false,
    hasPaymentLink: true,
    checkoutInProgress: false,
  });
  assert.equal(result.ready, true);
  assert.match(result.reason, /Secure checkout opens next/);
});
test('checkout is unavailable without billing permission', () => {
  const result = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: false,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /workspace owner/);
});
test('checkout is unavailable when neither managed billing nor a payment link can charge', () => {
  const result = getCheckoutReadiness({
    billingEnabled: false,
    canManageBilling: true,
    hasManagedIdentity: false,
    hasPaymentLink: false,
    checkoutInProgress: false,
  });
  assert.equal(result.ready, false);
  assert.equal(result.mode, 'manual');
  // Deliberately not "contact support / manual billing": with Stripe absent
  // there is no route the customer can take, so the copy says so plainly.
  assert.match(result.reason, /Billing is not configured yet/);
  assert.doesNotMatch(result.reason, /manual billing/i);
});
test('local managed checkout still needs sign-in when no payment link exists', () => {
  const result = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: false,
    hasPaymentLink: false,
    checkoutInProgress: false,
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /Sign in/);
});
test('managed identity or a payment link makes checkout available', () => {
  assert.equal(
    getCheckoutReadiness({
      billingEnabled: true,
      canManageBilling: true,
      hasManagedIdentity: true,
      hasPaymentLink: false,
      checkoutInProgress: false,
    }).ready,
    true,
  );
  assert.equal(
    getCheckoutReadiness({
      billingEnabled: true,
      canManageBilling: true,
      hasManagedIdentity: false,
      hasPaymentLink: true,
      checkoutInProgress: false,
    }).ready,
    true,
  );
});
test('recommendation moves one operating level at a time and respects selection', () => {
  assert.equal(recommendedTier('Starter'), 'Professional');
  assert.equal(recommendedTier('Enterprise'), 'Enterprise');
  assert.equal(recommendedTier('Starter', 'Ranch Ops'), 'Ranch Ops');
  assert.match(planOutcomes['Ranch Ops'].join(' '), /one rhythm/);
});
test('subscription prices stay aligned to the current approved pricing table', () => {
  assert.equal(subscriptionPlans.Starter.monthlyRate, 29);
  assert.equal(subscriptionPlans.Professional.monthlyRate, 79);
  assert.equal(subscriptionPlans['Ranch Ops'].monthlyRate, 199);
  assert.equal(subscriptionPlans.Enterprise.monthlyRate, 499);
});

test('no configuration produces a purchasable path when Stripe is absent', () => {
  // The promise this pins: with no managed billing and no payment link, there
  // is no combination of the remaining inputs that reports ready. A checkout
  // button that opens nothing, or a flow that reports success without a
  // payment, would both show up here as ready: true.
  for (const canManageBilling of [true, false]) {
    for (const hasManagedIdentity of [true, false]) {
      for (const checkoutInProgress of [true, false]) {
        const result = getCheckoutReadiness({
          billingEnabled: false,
          hasPaymentLink: false,
          canManageBilling,
          hasManagedIdentity,
          checkoutInProgress,
        });

        assert.equal(
          result.ready,
          false,
          `ready with billingEnabled=false hasPaymentLink=false canManage=${canManageBilling} identity=${hasManagedIdentity} inProgress=${checkoutInProgress}`,
        );
      }
    }
  }
});

test('a configured payment link is still purchasable', () => {
  // Guards the fix: the assertion above must not be satisfiable by a decision
  // function that simply never reports ready.
  const result = getCheckoutReadiness({
    billingEnabled: false,
    hasPaymentLink: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    checkoutInProgress: false,
  });
  assert.equal(result.ready, true);
  assert.equal(result.mode, 'checkout');
});

/*
 * A stored price is not proof of a live plan.
 *
 * `monthlyRate` is the rate of the plan that was bought, and it outlives a
 * cancellation. Four places used `monthlyRate > 0` as the "this plan is
 * current" signal, so a canceled Starter subscription looked like a current
 * Starter subscription: the billing screen labelled it as the active plan and
 * disabled its checkout button, leaving the customer unable to resubscribe to
 * the tier they had just lost, and the setup checklist marked billing complete.
 */

function profileWith(billingState: SubscriptionProfile['billingState'], tier: SubscriptionTier) {
  return { tier, monthlyRate: 29, billingState } as SubscriptionProfile;
}

test('only a paying or comped state counts as entitled', () => {
  assert.equal(isEntitledBillingState('Active'), true);
  assert.equal(isEntitledBillingState('Manual Billing'), true);
  assert.equal(isEntitledBillingState('Past Due'), false);
  assert.equal(isEntitledBillingState('Inactive'), false);
});

test('a lapsed plan is not the current plan, whatever its stored price says', () => {
  for (const billingState of ['Inactive', 'Past Due'] as const) {
    const subscription = profileWith(billingState, 'Starter');

    assert.equal(subscription.monthlyRate > 0, true, 'precondition: the old price is still stored');
    assert.equal(
      isCurrentPaidPlan(subscription, 'Starter'),
      false,
      `${billingState} must not present Starter as current, or its checkout is disabled and the customer cannot resubscribe`,
    );
  }
});

test('a freshly seeded workspace has not bought Starter', () => {
  // subscriptionSeed is Starter / 'Manual Billing' / rate 0. That is a setup
  // state, not a purchase: treating it as one labels Starter "Current plan" on
  // a brand-new workspace and disables the checkout, so it can never be bought.
  const seeded = subscriptionFixture({ tier: 'Starter', monthlyRate: 0, billingState: 'Manual Billing' });

  assert.equal(isEntitledBillingState(seeded.billingState), true, 'precondition: the seed state is entitled');
  assert.equal(isCurrentPaidPlan(seeded, 'Starter'), false, 'an unpaid setup must stay purchasable');
});

test('a real Starter subscription is current', () => {
  // The counterpart to the seed case: same tier and state, but actually paid.
  const paid = subscriptionFixture({ tier: 'Starter', monthlyRate: 29, billingState: 'Active' });
  assert.equal(isCurrentPaidPlan(paid, 'Starter'), true);
});

test('an entitled plan is current for its own tier and no other', () => {
  const subscription = profileWith('Active', 'Professional');

  assert.equal(isCurrentPaidPlan(subscription, 'Professional'), true);
  assert.equal(isCurrentPaidPlan(subscription, 'Starter'), false);
  assert.equal(isCurrentPaidPlan(subscription, 'Enterprise'), false);
});

test('no screen infers an active plan from the stored price', async () => {
  // The predicate only helps if nothing bypasses it. These are the consumers
  // that previously read the rate directly.
  for (const consumer of [
    'src/routes/Subscriptions.tsx',
    'src/routes/GettingStarted.tsx',
    'src/store/useXbarStore.ts',
  ]) {
    const source = await readFile(path.join(process.cwd(), consumer), 'utf8');
    assert.doesNotMatch(
      source,
      /monthlyRate > 0/,
      `${consumer} uses a stored price as an activity signal; use isEntitledBillingState / isCurrentPaidPlan`,
    );
  }
});

/*
 * A stored payload must not be able to grant more than its billing state
 * allows, whatever produced it.
 *
 * The client reads the subscription payload from the cloud and gates on it
 * directly — `tier`, `sharedAccessEnabled` and the usage limits. A payload can
 * disagree with its own billing state for reasons no single fix covers: it may
 * predate the effective-tier change, or simply be the last profile written
 * before the subscription lapsed, and a canceled workspace may never receive
 * another webhook to correct it.
 *
 * The policy lives here; restorePersistedState applies it at ingest, so the same
 * guard covers the cloud import, the local rehydrate, and a hand-imported
 * backup file.
 */

/** Zeroed counts plus Starter limits — the shape a fresh profile has. */
const initialUsage = {
  horsesUsed: 0,
  seatsUsed: 0,
  documentsProcessed: 0,
  salePacketsGenerated: 0,
  storageUsedGb: 0,
  sharedAccessSeatsUsed: 0,
  ...subscriptionPlans.Starter.limits,
};

/** A complete profile, so fixtures only state the fields under test. */
function subscriptionFixture(
  overrides: Partial<Omit<SubscriptionProfile, 'usage'>> & { usage?: Partial<SubscriptionProfile['usage']> },
): SubscriptionProfile {
  return {
    tier: 'Starter',
    monthlyRate: 29,
    renewalDate: '2026-01-01',
    billingState: 'Active',
    sharedAccessEnabled: false,
    featureFlags: [],
    ...overrides,
    usage: {
      ...(initialUsage as SubscriptionProfile['usage']),
      ...(overrides.usage ?? {}),
    },
  };
}

test('a stored payload is clamped to what its billing state supports', () => {
  const lapsed = clampSubscriptionToEntitlement(
    subscriptionFixture({
      tier: 'Enterprise',
      monthlyRate: 499,
      billingState: 'Inactive',
      sharedAccessEnabled: true,
      featureFlags: ['Everything in Ranch Ops'],
      usage: { horseLimit: 2000, seatLimit: 60, documentLimit: 20000 },
    }),
  );

  assert.equal(lapsed.tier, 'Starter', 'a lapsed payload must not keep the tier the gates read');
  assert.equal(lapsed.sharedAccessEnabled, false);
  assert.equal(lapsed.usage.horseLimit, 5);
  assert.equal(lapsed.usage.seatLimit, 1);

  // What was bought survives, so the billing screen can still name it.
  assert.equal(lapsed.purchasedTier, 'Enterprise');
  assert.equal(lapsed.monthlyRate, 499);
  assert.equal(lapsed.billingState, 'Inactive');
});

test('an entitled payload is left untouched', () => {
  for (const billingState of ['Active', 'Manual Billing'] as const) {
    const restored = clampSubscriptionToEntitlement(
      subscriptionFixture({
        tier: 'Enterprise',
        monthlyRate: 499,
        billingState,
        sharedAccessEnabled: true,
        featureFlags: [],
        usage: { horseLimit: 2000, seatLimit: 60 },
      }),
    );

    assert.equal(restored.tier, 'Enterprise', `${billingState} is entitled and must keep its tier`);
    assert.equal(restored.sharedAccessEnabled, true);
    assert.equal(restored.usage.horseLimit, 2000);
  }
});

test('a past-due payload drops to the baseline but keeps the account', () => {
  const pastDue = clampSubscriptionToEntitlement(
    subscriptionFixture({
      tier: 'Ranch Ops',
      monthlyRate: 199,
      billingState: 'Past Due',
      sharedAccessEnabled: true,
      featureFlags: [],
      usage: { horseLimit: 200 },
    }),
  );

  assert.equal(pastDue.tier, 'Starter');
  assert.equal(pastDue.purchasedTier, 'Ranch Ops');
  // Past Due is not the same as gone: the record of what they had is intact, so
  // recovering billing restores the tier rather than re-purchasing it.
  assert.equal(pastDue.billingState, 'Past Due');
});

/*
 * The onboarding checklist asks a different question from the billing cards,
 * but it has the same trap.
 *
 * A new workspace is seeded as Starter / 'Manual Billing' / rate 0. That state
 * is entitled, so an entitlement-only check ticks "Review billing" complete
 * before anyone has configured or bought anything — inflating onboarding
 * progress and hiding a real setup step.
 */
test('an unconfigured workspace has not completed billing setup', () => {
  const seeded = subscriptionFixture({ tier: 'Starter', monthlyRate: 0, billingState: 'Manual Billing' });

  assert.equal(isEntitledBillingState(seeded.billingState), true, 'precondition: the seed state is entitled');
  assert.equal(hasActivePaidPlan(seeded), false, 'a zero-rate seed is a setup state, not a purchase');
});

test('a paid or deliberately comped workspace has completed billing setup', () => {
  for (const billingState of ['Active', 'Manual Billing'] as const) {
    const paid = subscriptionFixture({ tier: 'Professional', monthlyRate: 79, billingState });
    assert.equal(hasActivePaidPlan(paid), true, `${billingState} with a real rate is configured billing`);
  }
});

test('a lapsed workspace has not completed billing setup', () => {
  for (const billingState of ['Inactive', 'Past Due'] as const) {
    const lapsed = subscriptionFixture({ tier: 'Professional', monthlyRate: 79, billingState });
    assert.equal(hasActivePaidPlan(lapsed), false, `${billingState} needs attention, not a completed checkmark`);
  }
});

test('no screen decides billing is configured from entitlement alone', async () => {
  const checklist = await readFile(path.join(process.cwd(), 'src/routes/GettingStarted.tsx'), 'utf8');

  assert.match(checklist, /hasActivePaidPlan\(subscription\)/);
  assert.doesNotMatch(
    checklist,
    /done: isEntitledBillingState\(/,
    'entitlement alone marks the zero-rate setup seed complete',
  );
});

/*
 * A past-due workspace must not be sold a second subscription.
 *
 * Making isCurrentPaidPlan honour billingState had a consequence I did not
 * follow through: a past-due plan stopped counting as "current", which enabled
 * every plan button and sent the selection to startManagedCheckout. That
 * endpoint opens a `mode: 'subscription'` session, so the customer would end up
 * paying for two subscriptions at once, both emitting webhooks that fight over
 * the same entitlement row. Refusing is the only safe answer the app can give —
 * settling the existing payment happens through Stripe.
 */
test('a workspace with a recoverable subscription is refused checkout on every path', () => {
  const base = {
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    checkoutInProgress: false,
    subscriptionRecoverable: true,
  };

  // Both configurations that would otherwise open checkout: the payment-link
  // path and the managed-session path.
  for (const hasPaymentLink of [true, false]) {
    const readiness = getCheckoutReadiness({ ...base, hasPaymentLink });

    assert.equal(readiness.ready, false, `hasPaymentLink=${hasPaymentLink} must not open checkout`);
    assert.equal(readiness.mode, 'recover');
    // The customer is not told to upgrade or that billing is unconfigured —
    // neither is true, and both would send them somewhere useless.
    assert.match(readiness.reason, /settled or resumed/);
    assert.doesNotMatch(readiness.reason, /not configured/);
  }
});

test('a workspace with no live subscription still reaches checkout', () => {
  // Guards the fix: blocking everything would satisfy the test above.
  const readiness = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    subscriptionRecoverable: false,
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.mode, 'checkout');
});

/*
 * A profile written before this field existed must not block checkout.
 *
 * Absent is read as "no live subscription", which is what those profiles meant:
 * they were written when Stripe could not tell us otherwise. Reading absent as
 * recoverable would lock every existing workspace out of buying a plan.
 */
test('a profile without the field is treated as having no live subscription', () => {
  const legacy = { tier: 'Starter', billingState: 'Inactive' } as SubscriptionProfile;
  const readiness = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    // The same expression Subscriptions.tsx uses.
    subscriptionRecoverable: isSubscriptionRecoverable(legacy),
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.mode, 'checkout');
});

/*
 * Legacy 'Past Due' profiles carry no flag and must still block checkout.
 *
 * The previous mapper stored past_due, unpaid AND incomplete_expired as
 * 'Past Due', and never produced 'Inactive' at all — so on any upgraded
 * deployment every lapsed workspace is sitting in 'Past Due' with no
 * subscriptionRecoverable field, and two of those three statuses leave a
 * subscription Stripe can still collect on.
 *
 * The billing screen used to block checkout on 'Past Due' outright. Replacing
 * that test with a field those rows do not carry re-enabled checkout for the
 * entire legacy population — the duplicate billing the flag exists to prevent,
 * reintroduced by the fix for it. The reconciliation migration does not help:
 * it only touches 'Manual Billing' rows.
 */
test('a legacy Past Due profile blocks checkout even without the flag', () => {
  const legacy = { tier: 'Starter', purchasedTier: 'Enterprise', billingState: 'Past Due' } as SubscriptionProfile;
  assert.equal(legacy.subscriptionRecoverable, undefined, 'the fixture must actually lack the field');
  assert.equal(isSubscriptionRecoverable(legacy), true);

  const readiness = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    subscriptionRecoverable: isSubscriptionRecoverable(legacy),
  });

  assert.equal(readiness.ready, false, 'a live subscription must not be bought twice');
  assert.equal(readiness.mode, 'recover');
});

test('a stored flag always wins over the fallback', () => {
  // The fallback is only for profiles that predate the field. Once Stripe has
  // told us, its answer is the one that counts — including the case the
  // fallback would get wrong on its own: a workspace whose subscription really
  // is over but whose stored state has not caught up.
  assert.equal(
    isSubscriptionRecoverable({ billingState: 'Past Due', subscriptionRecoverable: false } as SubscriptionProfile),
    false,
  );
  assert.equal(
    isSubscriptionRecoverable({ billingState: 'Inactive', subscriptionRecoverable: true } as SubscriptionProfile),
    true,
  );

  // And a workspace that never subscribed can still buy: no flag, not Past Due.
  assert.equal(isSubscriptionRecoverable({ billingState: 'Manual Billing' } as SubscriptionProfile), false);
  assert.equal(isSubscriptionRecoverable({ billingState: 'Active' } as SubscriptionProfile), false);
  assert.equal(isSubscriptionRecoverable({ billingState: 'Inactive' } as SubscriptionProfile), false);
});

/*
 * Restoring a lapsed plan is not an upgrade recommendation.
 *
 * The first version of this fix passed purchasedTier through recommendedTier,
 * which advances to the next plan up. It produced the right answer only for
 * Enterprise, where the clamp hides the advance — and Enterprise is the single
 * case I reasoned about. Every tier is covered here for that reason.
 */
test('a lapsed plan defaults to the tier that lapsed, at every tier', () => {
  for (const tier of ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'] as const) {
    const lapsed = subscriptionFixture({
      tier: 'Starter', // the baseline it fell back to
      purchasedTier: tier,
      billingState: 'Inactive',
      monthlyRate: 0,
    });

    const lapsedTier = isEntitledBillingState(lapsed.billingState) ? undefined : lapsed.purchasedTier;
    assert.equal(lapsedTier, tier, `a lapsed ${tier} should offer ${tier} back, not the next plan up`);
  }
});

test('an entitled workspace still gets an upgrade recommendation', () => {
  // Guards the other half: always preferring purchasedTier would make the
  // billing screen suggest the plan you already have.
  for (const billingState of ['Active', 'Manual Billing'] as const) {
    const current = subscriptionFixture({ tier: 'Professional', purchasedTier: 'Professional', billingState });

    const lapsedTier = isEntitledBillingState(current.billingState) ? undefined : current.purchasedTier;
    assert.equal(lapsedTier, undefined, `${billingState} must not be treated as a lapse`);
    assert.equal(recommendedTier(current.tier), 'Ranch Ops');
  }
});

test('the billing screen selects the lapsed tier rather than recommending from it', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/routes/Subscriptions.tsx'), 'utf8');

  // The exact shape of the bug: purchasedTier fed into the upgrade recommender.
  assert.doesNotMatch(
    source,
    /recommendedTier\(\s*subscription\.purchasedTier/,
    'passing the lapsed tier through recommendedTier advances a plan instead of restoring it',
  );
  assert.match(source, /lapsedTier \?\? recommendedTier\(subscription\.tier\)/);
});

/*
 * A tier string the build does not sell must never reach the plan tables.
 *
 * Persisted state and imported backups are cast to `SubscriptionProfile`
 * without validation, so an old, renamed, or hand-edited tier arrives looking
 * real. The billing screen indexes `subscriptionPlans` and `revenuePlanMatrix`
 * with `purchasedTier` when a subscription has lapsed — both return `undefined`
 * for an unknown string, and the route throws on the first field it reads. One
 * bad value in a restored backup takes the whole screen down.
 *
 * Normalized at the restore boundary rather than in the screen that crashed:
 * every consumer of these two fields has the same exposure, and guarding the
 * one that was reported is how the rest would have survived.
 */
test('an unknown tier decays to the baseline rather than to a paid plan', () => {
  assert.equal(normalizeTier('Platinum Elite'), 'Starter');
  assert.equal(normalizeTier(''), 'Starter');
  assert.equal(normalizeTier(undefined), 'Starter');
  assert.equal(normalizeTier(null), 'Starter');
  assert.equal(normalizeTier(42), 'Starter');
  assert.equal(normalizeTier({ tier: 'Enterprise' }), 'Starter');

  // Prototype keys are not tiers. `subscriptionPlans['constructor']` is truthy
  // through the prototype chain, so a naive `in` or truthiness check would
  // accept it and hand the screen an object that is not a plan.
  assert.equal(normalizeTier('constructor'), 'Starter');
  assert.equal(normalizeTier('toString'), 'Starter');

  // Real tiers pass through untouched.
  for (const tier of Object.keys(subscriptionPlans) as SubscriptionTier[]) {
    assert.equal(normalizeTier(tier), tier);
  }
});

test('clamping a lapsed subscription with an unknown tier leaves the screen renderable', () => {
  // The shape a restored backup arrives in: a tier this build does not sell,
  // on a subscription that has lapsed — the exact path that reaches the plan
  // tables through purchasedTier.
  const clamped = clampSubscriptionToEntitlement({
    tier: 'Platinum Elite',
    purchasedTier: 'Platinum Elite',
    billingState: 'Inactive',
    monthlyRate: 999,
    renewalDate: '',
    sharedAccessEnabled: true,
    featureFlags: [],
    usage: {},
  } as unknown as SubscriptionProfile);

  assert.ok(subscriptionPlans[clamped.tier], 'tier must index a real plan');
  assert.ok(subscriptionPlans[clamped.purchasedTier as SubscriptionTier], 'purchasedTier must index a real plan');

  // The exact expression Subscriptions.tsx uses to pick the plan to show.
  const lapsedTier = isEntitledBillingState(clamped.billingState) ? undefined : clamped.purchasedTier;
  const decisionTier = lapsedTier ?? recommendedTier(clamped.tier);
  assert.ok(subscriptionPlans[decisionTier], 'the selected plan must exist');
  assert.notEqual(subscriptionPlans[decisionTier].monthlyRate, undefined, 'and carry the fields the screen reads');
});

test('a paying workspace is not offered a second subscription', () => {
  // Not recoverable — it is working fine — so the recoverability check misses
  // it entirely, and the billing screen enables every other tier's button. That
  // is the ordinary upgrade path, and it opened a second `mode: 'subscription'`
  // session beside the one already being paid for.
  const readiness = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    subscriptionRecoverable: false,
    subscriptionActive: true,
  });

  assert.equal(readiness.ready, false);
  // The rule this test owns is the refusal and that it says why. Which
  // destination the copy names depends on whether a portal is configured, and
  // that question belongs to 'the copy promises a billing portal only when one
  // exists' — asserting the portal wording here pinned one deployment's text.
  assert.match(readiness.reason, /already has an active subscription/);
});

test('a workspace with no plan is still allowed to buy one', () => {
  const readiness = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    subscriptionRecoverable: false,
    subscriptionActive: false,
  });

  // The guard must not become a blanket refusal: nobody could ever subscribe.
  assert.equal(readiness.ready, true);
});

test('the billing screen asks both questions, not just recoverability', async () => {
  const source = await readFile('src/routes/Subscriptions.tsx', 'utf8');

  assert.match(source, /const subscriptionActive = hasActivePaidPlan\(subscription\);/);

  /*
   * All THREE readiness call sites — the selected-plan readiness, the per-plan
   * card, and the click handler. Missing any one leaves a control that promises
   * checkout and is then refused: with only two, the prominent CTA stayed
   * enabled while every plan card below it was disabled.
   *
   * Scoped to the call sites rather than counting the bare identifier across
   * the file. The count broke the moment anything else legitimately read the
   * flag, which says nothing about whether the three gates agree.
   */
  const readinessCalls = source.split('getCheckoutReadiness({').slice(1);
  assert.equal(readinessCalls.length, 3, 'the screen must ask readiness in exactly three places');
  for (const call of readinessCalls) {
    const args = call.slice(0, call.indexOf('});'));
    assert.match(args, /\bsubscriptionActive,/, 'every readiness call site must ask about an active subscription');
    assert.match(args, /\bsubscriptionRecoverable,/, 'and about a recoverable one');
  }
});

test('a malformed recovery flag withholds checkout instead of falling through', () => {
  /*
   * The flag is written by the server and carried through a backup untouched:
   * `restorePersistedState` spreads the stored subscription and normalizes
   * `billingState`, `tier`, `purchasedTier` and `usage`, and the restore
   * preflight does not inspect the subscription at all.
   *
   * So a hand-edited or corrupted backup can present `"false"` or `{}` here.
   * The billing state cannot answer for it either, because paused and unpaid
   * subscriptions — the ones Stripe can still collect on — are stored as
   * 'Inactive', not 'Past Due'. Falling through returned false and offered a
   * payment link to a workspace that is already being billed.
   */
  for (const malformed of ['false', 'true', '', {}, [], 0, 1, Number.NaN]) {
    assert.equal(
      isSubscriptionRecoverable({
        billingState: 'Inactive',
        subscriptionRecoverable: malformed,
      } as unknown as SubscriptionProfile),
      true,
      `a ${typeof malformed} recovery flag must withhold checkout, not fall through`,
    );
  }

  // And the refusal actually reaches the button: `recover` is the mode that
  // stops a second subscription being created beside a live one.
  const readiness = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: false,
    hasPaymentLink: true,
    checkoutInProgress: false,
    subscriptionRecoverable: isSubscriptionRecoverable({
      billingState: 'Inactive',
      subscriptionRecoverable: 'false',
    } as unknown as SubscriptionProfile),
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.mode, 'recover');
  assert.match(readiness.reason, /bill you twice/);
});

test('an ABSENT recovery flag still falls back to the billing state', () => {
  /*
   * The over-correction guard, and the reason absent and malformed are treated
   * differently. Legacy rows carry no flag at all, and every one of them that
   * was `past_due` or `unpaid` was stored as 'Past Due'. Reading absent as
   * "recoverable" would withhold checkout from that entire population — a
   * safety guard that stops people paying is worse than the harm it prevents.
   */
  assert.equal(isSubscriptionRecoverable({ billingState: 'Past Due' } as SubscriptionProfile), true);
  assert.equal(isSubscriptionRecoverable({ billingState: 'Inactive' } as SubscriptionProfile), false);
  assert.equal(
    isSubscriptionRecoverable({ billingState: 'Inactive', subscriptionRecoverable: undefined } as SubscriptionProfile),
    false,
    'undefined is absent, not malformed',
  );
  assert.equal(
    isSubscriptionRecoverable({
      billingState: 'Inactive',
      subscriptionRecoverable: null,
    } as unknown as SubscriptionProfile),
    false,
    'null is how JSON round-trips an absent optional field',
  );

  // An explicit boolean is still obeyed in both directions.
  assert.equal(
    isSubscriptionRecoverable({ billingState: 'Past Due', subscriptionRecoverable: false } as SubscriptionProfile),
    false,
  );
  assert.equal(
    isSubscriptionRecoverable({ billingState: 'Inactive', subscriptionRecoverable: true } as SubscriptionProfile),
    true,
  );
});

/*
 * A refusal owes the customer somewhere to go.
 *
 * Checkout is correctly blocked for a workspace that already has a
 * subscription — a second `mode: 'subscription'` session would bill them twice.
 * But refusing was the whole of the answer: the primary action rendered
 * disabled, the plan cards returned without navigating, and
 * `stripeConfig.billingPortalUrl` was read from the environment and consumed by
 * nothing. Every upgrade, downgrade, payment recovery and cancellation was a
 * dead end, while the copy told them to use a billing portal the app never
 * linked to.
 */

test('a workspace with a subscription is routed to the billing portal', () => {
  const portal = 'https://billing.stripe.com/p/session/test';

  assert.deepEqual(getBillingPortalAction({ portalUrl: portal, canManageBilling: true, subscriptionActive: true }), {
    url: portal,
    label: 'Manage your subscription',
  });
  assert.deepEqual(
    getBillingPortalAction({ portalUrl: portal, canManageBilling: true, subscriptionRecoverable: true }),
    { url: portal, label: 'Settle your payment' },
  );

  // Whitespace is not a configured portal.
  assert.equal(getBillingPortalAction({ portalUrl: '   ', canManageBilling: true, subscriptionActive: true }), null);
});

test('the portal is offered only when there is a subscription and a place to send it', () => {
  const portal = 'https://billing.stripe.com/p/session/test';

  // The over-rejection direction is not the risk here; the risk is offering a
  // door that opens on nothing. No portal configured means the disabled button
  // and its honest reason stay, because a link to nowhere is worse.
  assert.equal(getBillingPortalAction({ portalUrl: '', canManageBilling: true, subscriptionActive: true }), null);

  // Nothing to manage: a workspace that has never subscribed must still be
  // sent to checkout, not to a portal that would show it an empty account.
  assert.equal(getBillingPortalAction({ portalUrl: portal, canManageBilling: true }), null);
  assert.equal(
    getBillingPortalAction({
      portalUrl: portal,
      canManageBilling: true,
      subscriptionActive: false,
      subscriptionRecoverable: false,
    }),
    null,
  );

  // A member who may not manage billing is not handed the owner's portal.
  assert.equal(getBillingPortalAction({ portalUrl: portal, canManageBilling: false, subscriptionActive: true }), null);
});

test('the portal never makes a second subscription purchasable', () => {
  /*
   * The invariant this change must not touch. Routing to the portal is safe
   * precisely because Stripe's portal acts on the subscription that already
   * exists; readiness still answers a different question — whether a NEW one
   * may be created — and it must stay false in both states.
   */
  const base = {
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    hasBillingPortal: true,
  };

  assert.equal(getCheckoutReadiness({ ...base, subscriptionActive: true }).ready, false);
  assert.equal(getCheckoutReadiness({ ...base, subscriptionRecoverable: true }).ready, false);
});

test('the copy promises a billing portal only when one exists', () => {
  const base = {
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    subscriptionActive: true,
  };

  // Telling someone to change plans in a portal this deployment does not have
  // sends them looking for a door that is not there.
  assert.match(getCheckoutReadiness({ ...base, hasBillingPortal: true }).reason, /billing portal/);
  assert.doesNotMatch(getCheckoutReadiness({ ...base, hasBillingPortal: false }).reason, /billing portal/);

  // Either way the refusal itself is unchanged and still says why.
  for (const hasBillingPortal of [true, false]) {
    const readiness = getCheckoutReadiness({ ...base, hasBillingPortal });
    assert.equal(readiness.ready, false);
    assert.match(readiness.reason, /already has an active subscription/);
  }
});

test('the billing screen routes a blocked plan card to the portal', async () => {
  const screen = await readFile(path.join(process.cwd(), 'src/routes/Subscriptions.tsx'), 'utf8');

  // The defect was a silent `return`. Wiring is React plumbing the node suite
  // cannot reach, so this pins the property that a blocked card does something.
  assert.match(
    screen,
    /if \(!readiness\.ready\) \{[\s\S]*?if \(billingPortalAction\) openBillingPortal\(\);/,
    'a plan card that cannot open checkout must offer the portal instead of returning silently',
  );
  assert.match(
    screen,
    /billingPortalAction \? \([\s\S]*?onClick=\{openBillingPortal\}/,
    'the primary action must become the portal rather than a disabled button',
  );
});

/*
 * A hosted purchase this deployment cannot confirm.
 *
 * With managed billing off there is no webhook, so completing a payment link
 * changes nothing the app can see. The customer returns from Stripe to a page
 * that still says Starter with the buttons still enabled, does the obvious
 * thing, and Stripe sells them a second subscription.
 */

test('a started hosted purchase holds checkout closed', () => {
  const startedAt = new Date('2026-09-02T03:00:00Z');
  const pending = { tier: 'Professional' as const, startedAt: startedAt.toISOString(), workspaceId: 'ws-1' };

  assert.equal(isPendingHostedPurchase(pending, new Date('2026-09-02T03:05:00Z'), 'ws-1'), true);
  // Still pending most of a day later: a manual grant can wait for someone's
  // morning, and a second charge in the meantime is the thing being prevented.
  assert.equal(isPendingHostedPurchase(pending, new Date('2026-09-02T23:00:00Z'), 'ws-1'), true);
});

test('a started purchase does not lock the customer out forever', () => {
  /*
   * The over-rejection direction, and the one that costs a sale. Nothing here
   * can tell an ABANDONED checkout from an unconfirmed one, so the marker has
   * to expire — and the screen also offers an explicit way out, because the
   * person who knows they did not pay should not wait a day to say so.
   */
  const pending = { tier: 'Professional' as const, startedAt: '2026-09-01T03:00:00Z', workspaceId: 'ws-1' };
  assert.equal(isPendingHostedPurchase(pending, new Date('2026-09-02T04:00:00Z'), 'ws-1'), false);
  assert.equal(isPendingHostedPurchase(null, new Date(), 'ws-1'), false);
});

test('a damaged pending marker must not stop someone paying', () => {
  /*
   * A stored value that blocks checkout is the worse of the two failures
   * available here: a missing guard risks a double charge the customer can get
   * refunded, while a stuck guard means they cannot buy at all.
   */
  assert.equal(parsePendingHostedPurchase(null), null);
  assert.equal(parsePendingHostedPurchase('not json'), null);
  assert.equal(parsePendingHostedPurchase('{}'), null);
  assert.equal(parsePendingHostedPurchase(JSON.stringify({ tier: {}, startedAt: 'x' })), null);
  assert.equal(parsePendingHostedPurchase(JSON.stringify({ tier: 'Professional' })), null);
  assert.equal(parsePendingHostedPurchase(JSON.stringify({ tier: 'Professional', startedAt: 'nonsense' })), null);
  /*
   * A NUMBER is the case the type test earns its keep on, and the reason
   * `Date.parse` cannot stand alone: `Date.parse(2026)` is a valid timestamp,
   * so a numeric `startedAt` would sail through and then throw on the
   * `.slice(0, 10)` that builds the notice — crashing the billing screen
   * rather than merely losing the guard.
   */
  assert.equal(parsePendingHostedPurchase(JSON.stringify({ tier: 'Professional', startedAt: 2026 })), null);
  assert.equal(parsePendingHostedPurchase(JSON.stringify({ tier: 2026, startedAt: '2026-09-02T03:00:00Z' })), null);
  /*
   * A marker with no workspace was written before the field existed. It is
   * refused rather than adopted: guessing which workspace it belonged to could
   * block the wrong one, and losing a guard leans toward letting someone buy —
   * the direction every default here takes.
   */
  assert.equal(
    parsePendingHostedPurchase(JSON.stringify({ tier: 'Professional', startedAt: '2026-09-02T03:00:00Z' })),
    null,
  );
  assert.deepEqual(
    parsePendingHostedPurchase(
      JSON.stringify({ tier: 'Professional', startedAt: '2026-09-02T03:00:00Z', workspaceId: 'ws-1' }),
    ),
    { tier: 'Professional', startedAt: '2026-09-02T03:00:00Z', workspaceId: 'ws-1' },
  );
});

test('one workspace cannot block another from buying', () => {
  /*
   * Browser storage is origin-wide and workspaces are not. A single key held
   * one marker for the whole origin, so a rancher managing two workspaces in
   * one browser carried A's pending purchase into B: B was blocked for a day
   * with a notice about a purchase it never made, and clearing it to let B
   * through removed A's duplicate-charge protection at the same time.
   */
  const pending = { tier: 'Professional' as const, startedAt: '2026-09-02T03:00:00Z', workspaceId: 'ws-a' };
  const now = new Date('2026-09-02T03:05:00Z');

  assert.equal(isPendingHostedPurchase(pending, now, 'ws-a'), true, 'the workspace that started it is still held');
  assert.equal(isPendingHostedPurchase(pending, now, 'ws-b'), false, 'another workspace is not');

  // The keys are separate too, so the two markers coexist and clearing one
  // cannot remove the other's protection.
  assert.notEqual(pendingHostedPurchaseKey('ws-a'), pendingHostedPurchaseKey('ws-b'));
  assert.match(pendingHostedPurchaseKey('ws-a'), /ws-a/);

  /*
   * A local-only session has no workspace id at all — that is the
   * `no_managed_identity` route by definition — so it gets its own stable
   * scope rather than colliding with every cloud workspace on an empty string.
   */
  assert.equal(pendingHostedPurchaseKey(''), pendingHostedPurchaseKey(''));
  assert.notEqual(pendingHostedPurchaseKey(''), pendingHostedPurchaseKey('ws-a'));
  const local = { tier: 'Starter' as const, startedAt: '2026-09-02T03:00:00Z', workspaceId: '' };
  assert.equal(isPendingHostedPurchase(local, now, ''), true);
  assert.equal(isPendingHostedPurchase(local, now, 'ws-a'), false);
});

test('a clock that moved backwards still counts as pending', () => {
  // A future timestamp is a clock change, not a purchase from tomorrow.
  // Reading it as pending is the answer that does not charge twice.
  const pending = { tier: 'Ranch Ops' as const, startedAt: '2026-09-03T03:00:00Z', workspaceId: 'ws-1' };
  assert.equal(isPendingHostedPurchase(pending, new Date('2026-09-02T03:00:00Z'), 'ws-1'), true);
});

test('the notice says what is true here, not that the plan is active', () => {
  const notice = pendingHostedPurchaseNotice({
    tier: 'Ranch Ops',
    startedAt: '2026-09-02T03:00:00Z',
    workspaceId: 'ws-1',
  });

  assert.match(notice, /Ranch Ops/);
  assert.match(notice, /2026-09-02/);
  assert.match(notice, /by hand/, 'the customer must be told why nothing has changed yet');
  assert.match(notice, /charge you a second time/, 'and why they should not simply buy again');
  assert.doesNotMatch(notice, /active|activated successfully/i, 'nothing here knows the payment landed');
});

test('the pending marker stops applying once the workspace is entitled', async () => {
  const screen = await readFile(path.join(process.cwd(), 'src/routes/Subscriptions.tsx'), 'utf8');

  /*
   * The ordering — refuse before redirecting, record before leaving the page —
   * moved into `followPaymentLink` when the fallback route was found to be
   * unguarded, and is asserted at its new home below. What stays here is what
   * that helper cannot own: when the marker stops mattering, and how a customer
   * gets out of one they know is wrong.
   */
  assert.match(
    screen,
    /isPendingHostedPurchase\([\s\S]{0,60}\) && !subscriptionActive/,
    'an entitled workspace has been reconciled, so the marker must stop applying',
  );
  assert.match(
    screen,
    /I did not complete that purchase/,
    'and nothing here can tell an abandoned checkout from an unconfirmed one, so the customer must be able to say',
  );
});

test('every payment-link redirect goes through the pending-purchase guard', async () => {
  const screen = await readFile(path.join(process.cwd(), 'src/routes/Subscriptions.tsx'), 'utf8');

  /*
   * There are two routes to a payment link — the hosted-only primary route and
   * the `no_managed_identity` fallback — and they are the same act with the
   * same consequence: a static link that cannot associate its subscription
   * with a workspace, in a deployment with no webhook to confirm it. The guard
   * shipped on one branch and not the other, so this pins the shape that makes
   * that impossible rather than the two call sites.
   */
  const helperAt = screen.indexOf('const followPaymentLink = async (');
  assert.ok(helperAt > -1, 'the single payment-link redirect must be findable');
  const helper = screen.slice(helperAt, screen.indexOf('const openBillingPortal', helperAt));

  /*
   * One CLAIM, not a read followed by a write. Re-reading storage instead of a
   * cached snapshot fixed the tab that decided from stale state, but two tabs
   * clicking at once can both finish a read before either writes, and a
   * check-then-set they both pass guards nothing. The claim puts the read and
   * the write inside one cross-tab lock; splitting them again reopens the
   * window, and the marker's workspace stamp is carried into it here — a
   * marker written under the local scope while a cloud workspace is open never
   * matches on read, which loses the guard with the suite still green.
   */
  assert.match(
    helper,
    /const claim = await claimPendingHostedPurchase\(\s*\{ tier, startedAt: new Date\(\)\.toISOString\(\), workspaceId \},\s*new Date\(\),\s*!subscriptionActive,\s*\);/,
    'the redirect must claim the purchase under the lock, stamped with its workspace',
  );
  assert.match(helper, /if \(!claim\.claimed\)/, 'and refuse when the claim is refused');
  assert.doesNotMatch(
    helper,
    /readPendingHostedPurchase|writePendingHostedPurchase/,
    'reading or writing the marker beside the claim is the check-then-set that was removed',
  );
  const claimAt = helper.indexOf('claimPendingHostedPurchase(');
  const assignAt = helper.indexOf('window.location.assign(link)');
  assert.ok(claimAt > -1 && assignAt > claimAt, 'and it must claim before it leaves the page');
  assert.match(
    screen,
    /isPendingHostedPurchase\(pendingPurchase, new Date\(\), workspaceId\)/,
    'and it must be read back against the workspace being viewed, not the one on the marker',
  );
  assert.match(helper, /window\.location\.assign\(link\)/, 'before leaving the page');

  /*
   * And nothing else may follow a link. Three redirects exist — the guarded
   * payment link, the billing portal, and a managed checkout session, neither
   * of which is a static link — so a FOURTH is the thing to catch: it is how a
   * new route would skip this guard, exactly as the fallback did.
   */
  const assigned = [...screen.matchAll(/window\.location\.assign\(([^)]+)\)/g)].map(([, expression]) => expression);
  assert.deepEqual(
    assigned.sort(),
    ['billingPortalAction.url', 'link', 'managed.url'],
    'a new redirect must be routed through followPaymentLink, not added beside it',
  );

  // Both call sites must actually use the helper rather than reimplementing it.
  assert.match(screen, /await followPaymentLink\(tier, hostedOnlyLink\);/, 'the hosted-only route');
  assert.match(screen, /await followPaymentLink\(tier, fallback, managed\.message\);/, 'and the no-identity fallback');
});

test('a second billing tab learns about the first tab’s purchase', async () => {
  const screen = await readFile(path.join(process.cwd(), 'src/routes/Subscriptions.tsx'), 'utf8');

  /*
   * The redirect re-reads storage, which is what stops the second charge. This
   * is the other half: without it, tab B keeps showing an enabled buy button
   * and an out-of-date notice, inviting a click that will be refused. A guard
   * that only fires at the last moment is correct and still bad manners.
   */
  assert.match(screen, /window\.addEventListener\('storage', syncFromStorage\)/, 'other tabs must be heard');
  assert.match(screen, /window\.removeEventListener\('storage', syncFromStorage\)/, 'and the listener cleaned up');

  const effectAt = screen.indexOf('const syncFromStorage = (event: StorageEvent)');
  assert.ok(effectAt > -1, 'the storage handler must be findable');
  const handler = screen.slice(effectAt, screen.indexOf('window.addEventListener', effectAt));

  assert.match(
    handler,
    /event\.key && event\.key !== pendingHostedPurchaseKey\(workspaceId\)/,
    'another workspace’s marker must not disturb this screen, but a cleared store (null key) must',
  );
  assert.match(handler, /setPendingPurchase\(readPendingHostedPurchase\(workspaceId\)\)/, 'and the state must refresh');
});

test('all pending-marker storage access goes through one module', async () => {
  const screen = await readFile(path.join(process.cwd(), 'src/routes/Subscriptions.tsx'), 'utf8');

  /*
   * The same choke-point rule that fixed the two payment-link redirects. The
   * screen reached into localStorage in three places, and the read that mattered
   * was the one that never happened. Keeping every access in
   * `pendingHostedPurchase` means a new call site cannot quietly skip the
   * parse, the workspace scope, or the try/catch.
   */
  assert.doesNotMatch(
    screen,
    /window\.localStorage\.(get|set|remove)Item\(/,
    'the billing screen must not touch localStorage directly',
  );
});

/*
 * The claim lock.
 *
 * Reading storage rather than a cached snapshot fixed the tab that decided
 * from stale state, but a check-then-set both tabs pass is still not a claim:
 * two tabs can finish the read before either writes, and both then redirect to
 * an independently completable payment link.
 *
 * A single JavaScript thread cannot reproduce true parallelism, so these tests
 * do not pretend to race. They pin the structural property that makes the race
 * impossible instead: the read and the write both happen INSIDE the lock, and
 * two claimants' critical sections never interleave.
 */
interface ClaimHarness {
  events: string[];
  store: Map<string, string>;
  restore: () => void;
}

function installClaimHarness(locks?: unknown, log?: string[]): ClaimHarness {
  // One log for the lock and for storage, so what is asserted is the ORDER of
  // storage access against the lock rather than each merely being present.
  const events: string[] = log ?? [];
  const store = new Map<string, string>();
  const globals = globalThis as { window?: unknown; navigator?: unknown };
  const previousWindow = globals.window;
  const previousNavigator = globals.navigator;
  const previousDescriptor = Object.getOwnPropertyDescriptor(globals, 'navigator');

  globals.window = {
    localStorage: {
      getItem: (key: string) => {
        events.push('read');
        return store.has(key) ? (store.get(key) as string) : null;
      },
      setItem: (key: string, value: string) => {
        events.push('write');
        store.set(key, value);
      },
      removeItem: (key: string) => {
        events.push('remove');
        store.delete(key);
      },
    },
  };
  // `navigator` is a getter-only global in Node, so a plain assignment throws.
  Object.defineProperty(globals, 'navigator', { value: { locks }, configurable: true, writable: true });

  return {
    events,
    store,
    restore: () => {
      if (previousWindow === undefined) delete globals.window;
      else globals.window = previousWindow;
      if (previousDescriptor) Object.defineProperty(globals, 'navigator', previousDescriptor);
      else if (previousNavigator === undefined) delete globals.navigator;
    },
  };
}

const DEFAULT_CLAIM_STARTED_AT = '2026-09-02T04:00:00.000Z';

/*
 * `startedAt` is settable, and has to be.
 *
 * It was hardcoded, so every marker in this file was born inside the pending
 * window no matter what clock a test handed the code under test. An EXPIRED
 * marker — the thing the 24-hour window exists to produce, and the state that
 * decides whether a workspace may buy again — could not be built here at all,
 * which is why a migration that kept expired markers passed every case.
 */
const claimFor = (workspaceId: string, tier = 'Pro', startedAt = DEFAULT_CLAIM_STARTED_AT): PendingHostedPurchase => ({
  tier: tier as SubscriptionTier,
  startedAt,
  workspaceId,
});

test('the read and the write both happen inside the claim lock', async () => {
  /*
   * The whole finding in one assertion. A read taken before the lock, or a
   * write left after it, restores exactly the window two tabs slipped through
   * — and either shows up here as a reordered log.
   */
  const events: string[] = [];
  const locks = {
    request: async <T>(name: string, run: () => Promise<T>): Promise<T> => {
      events.push(`acquire:${name}`);
      try {
        return await run();
      } finally {
        events.push('release');
      }
    },
  };
  const harness = installClaimHarness(locks, events);
  try {
    const result = await claimPendingHostedPurchase(claimFor('ws-a'), new Date('2026-09-02T04:00:01.000Z'), true);
    assert.equal(result.claimed, true, 'an unclaimed workspace must be claimable');
    assert.deepEqual(
      events,
      ['acquire:xbar-pending-hosted-purchase-claim', 'read', 'write', 'release'],
      'the read and the write must both sit inside the lock',
    );
  } finally {
    harness.restore();
  }
});

test('two claimants never interleave their read and write', async () => {
  /*
   * A lock manager that actually queues, and two claims started before either
   * has run. Without the lock there are no acquire events at all and the two
   * critical sections appear back to back — which is the log this rejects.
   */
  const events: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const locks = {
    request: <T>(_name: string, run: () => Promise<T>): Promise<T> => {
      const next = chain.then(async () => {
        events.push('acquire');
        try {
          return await run();
        } finally {
          events.push('release');
        }
      });
      chain = next.catch(() => undefined);
      return next as Promise<T>;
    },
  };
  const harness = installClaimHarness(locks, events);
  try {
    const now = new Date('2026-09-02T04:00:01.000Z');
    const [first, second] = await Promise.all([
      claimPendingHostedPurchase(claimFor('ws-a', 'Pro'), now, true),
      claimPendingHostedPurchase(claimFor('ws-a', 'Ranch'), now, true),
    ]);

    assert.deepEqual(
      events,
      ['acquire', 'read', 'write', 'release', 'acquire', 'read', 'release'],
      'the second claimant must not read until the first has written and released',
    );
    const claims = [first, second];
    assert.equal(claims.filter((claim) => claim.claimed).length, 1, 'exactly one claimant may proceed');
    const refused = claims.find((claim) => !claim.claimed);
    assert.ok(refused && !refused.claimed, 'the other must be refused');
    assert.equal(refused.blockedBy.tier, 'Pro', 'and told about the purchase that actually won');
  } finally {
    harness.restore();
  }
});

test('a browser with no lock manager can still buy', async () => {
  /*
   * Non-secure contexts and older browsers have no `navigator.locks`. Losing
   * the lock costs the narrow two-tab window; refusing to sell would cost the
   * sale, which is the worse of the two and the direction every default in
   * this module leans.
   */
  const harness = installClaimHarness(undefined);
  try {
    const result = await claimPendingHostedPurchase(claimFor('ws-a'), new Date('2026-09-02T04:00:01.000Z'), true);
    assert.equal(result.claimed, true, 'the purchase must still go through');
    assert.deepEqual(harness.events, ['read', 'write'], 'and the body must run exactly once');
    assert.equal(harness.store.size, 1, 'the marker is still written');
  } finally {
    harness.restore();
  }
});

test('a lock manager that refuses does not stop the sale', async () => {
  const harness = installClaimHarness({
    request: () => Promise.reject(new Error('LockManager unavailable')),
  });
  try {
    const result = await claimPendingHostedPurchase(claimFor('ws-a'), new Date('2026-09-02T04:00:01.000Z'), true);
    assert.equal(result.claimed, true, 'a refused lock must fall back, not block checkout');
    assert.deepEqual(harness.events, ['read', 'write'], 'and the body must run exactly once');
  } finally {
    harness.restore();
  }
});

test('a failure inside the claim is not retried', async () => {
  /*
   * The fallback exists for a lock manager that refuses to grant the lock. A
   * critical section that started and then threw is a different thing: running
   * it again could write a second marker — or, in a future body, take a second
   * action — for one click.
   */
  const harness = installClaimHarness({
    request: async <T>(_name: string, run: () => Promise<T>): Promise<T> => run(),
  });
  try {
    let runs = 0;
    await assert.rejects(
      withPendingPurchaseLock(() => {
        runs += 1;
        throw new Error('storage exploded');
      }),
      /storage exploded/,
    );
    assert.equal(runs, 1, 'a body that has already started must not be run a second time');
  } finally {
    harness.restore();
  }
});

test('an active subscriber is not blocked by their own pending marker', async () => {
  /*
   * `enforceGuard` is false once a plan is active: that customer is managing a
   * subscription they hold, not being sold a duplicate. The write still
   * happens inside the lock, so the two paths cannot interleave either.
   */
  const harness = installClaimHarness(undefined);
  try {
    const now = new Date('2026-09-02T04:00:01.000Z');
    await claimPendingHostedPurchase(claimFor('ws-a', 'Pro'), now, true);
    const second = await claimPendingHostedPurchase(claimFor('ws-a', 'Ranch'), now, false);
    assert.equal(second.claimed, true, 'an active subscriber must not be held by the guard');

    const third = await claimPendingHostedPurchase(claimFor('ws-a', 'Ranch'), now, true);
    assert.equal(third.claimed, false, 'while a buyer still is');
  } finally {
    harness.restore();
  }
});

test('the billing screen claims the purchase rather than reading and writing it', async () => {
  const screen = await readFile(path.join(process.cwd(), 'src/routes/Subscriptions.tsx'), 'utf8');

  assert.match(screen, /const claim = await claimPendingHostedPurchase\(/, 'the redirect must claim');
  assert.doesNotMatch(
    screen,
    /writePendingHostedPurchase/,
    'writing the marker outside the claim reopens the check-then-set window',
  );

  const assigned = [...screen.matchAll(/await followPaymentLink\(/g)];
  assert.equal(assigned.length, 2, 'both payment-link routes must await the claim before redirecting');
});

/*
 * Signing in must not hand back a purchase already in flight.
 *
 * The marker is scoped to a workspace on purpose — one browser can hold two
 * ranches, and a purchase started by one must not block the other. Promotion
 * is the case scoping alone gets wrong: the same person, the same browser, the
 * same purchase, and a new `workspaceId`. Both the screen and the claim then
 * look under a key nobody wrote.
 */
test('a local ranch carries its pending purchase into the workspace it becomes', async () => {
  const harness = installClaimHarness(undefined);
  try {
    const now = new Date('2026-09-02T04:00:01.000Z');
    const started = await claimPendingHostedPurchase(claimFor('', 'Pro'), now, true);
    assert.equal(started.claimed, true, 'the local ranch starts a purchase');

    migratePendingHostedPurchase('', 'ws-new', now);

    const again = await claimPendingHostedPurchase(claimFor('ws-new', 'Pro'), now, true);
    assert.equal(again.claimed, false, 'the promoted workspace must still be held by it');
    assert.equal(
      again.claimed === false && again.blockedBy.startedAt,
      '2026-09-02T04:00:00.000Z',
      'and the original start time is carried, not restamped',
    );
    assert.equal(readPendingHostedPurchase(''), null, 'the local copy is not left behind to fire twice');
  } finally {
    harness.restore();
  }
});

test('a promotion does not overwrite a purchase the workspace already had', async () => {
  const harness = installClaimHarness(undefined);
  try {
    const now = new Date('2026-09-02T04:00:01.000Z');
    await claimPendingHostedPurchase(claimFor('', 'Pro'), now, true);
    await claimPendingHostedPurchase(claimFor('ws-new', 'Ranch'), now, true);

    // `now` is passed explicitly. Without it this defaulted to the real clock,
    // so the destination marker was long expired and the test passed only
    // because ANY marker used to win — the very bug below.
    migratePendingHostedPurchase('', 'ws-new', now);

    const kept = readPendingHostedPurchase('ws-new');
    assert.equal(kept?.tier, 'Ranch', 'a STILL-PENDING marker of the workspace’s own is the one that belongs there');
    assert.equal(readPendingHostedPurchase(''), null, 'and the stale copy is dropped rather than merged');
  } finally {
    harness.restore();
  }
});

test('promotion to nothing, or to the same scope, changes nothing', async () => {
  // The over-rejection direction: a no-op promotion must not move or drop a
  // marker, or an ordinary reload would clear the guard.
  const harness = installClaimHarness(undefined);
  try {
    const now = new Date('2026-09-02T04:00:01.000Z');
    await claimPendingHostedPurchase(claimFor('', 'Pro'), now, true);

    for (const target of ['', 'local']) {
      migratePendingHostedPurchase('', target);
      assert.equal(readPendingHostedPurchase('')?.tier, 'Pro', `promotion to ${JSON.stringify(target)} is a no-op`);
    }
  } finally {
    harness.restore();
  }
});

test('signing out does not hand a cloud purchase to the local ranch', async () => {
  // The reverse direction. Promotion only ever runs local -> cloud, so a call
  // pointing the other way is a sign-out, not a promotion, and the cloud
  // workspace's marker has to stay where it is. The local scope is shared by
  // every signed-out session on the machine; moving a paid workspace's claim
  // there would let the next unrelated session consume it.
  const harness = installClaimHarness(undefined);
  try {
    const now = new Date('2026-09-02T04:00:01.000Z');
    await claimPendingHostedPurchase(claimFor('ws-a', 'Pro'), now, true);

    for (const target of ['', 'local']) {
      migratePendingHostedPurchase('ws-a', target);
      assert.equal(
        readPendingHostedPurchase('ws-a')?.tier,
        'Pro',
        `signing out to ${JSON.stringify(target)} leaves the cloud marker alone`,
      );
      assert.equal(readPendingHostedPurchase(target), null, `and writes nothing into ${JSON.stringify(target)}`);
    }
  } finally {
    harness.restore();
  }
});

test('the promotion path is the one place that carries the marker', async () => {
  /*
   * Called inside `promoteLocalVaultFiles` rather than at its two call sites,
   * because that is where the "this really is a promotion" test already lives:
   * an import must not inherit another ranch's purchase.
   */
  const promotion = await readFile(path.join(process.cwd(), 'src/lib/workspacePromotion.ts'), 'utf8');
  assert.match(promotion, /migratePendingHostedPurchase\('', owner\);/, 'the marker must move with the records');

  const guardAt = promotion.indexOf("if (recorded && recorded !== 'local')");
  const migrateAt = promotion.indexOf('migratePendingHostedPurchase(');
  assert.ok(guardAt > -1 && migrateAt > guardAt, 'and only after the import check has let it through');
});

test('the entitlement clamp actually runs on an ordinary reload', async () => {
  /*
   * The clamp was written, shipped, and never ran.
   *
   * restorePersistedState is where clampSubscriptionToEntitlement is applied to
   * a rehydrate, and Zustand calls it only through `migrate` — which fires only
   * when the stored version differs from the configured one. The version stayed
   * at 8 while every existing install was already stored at 8, so a reload
   * skipped the whole thing: a lapsed workspace kept displaying the paid tier
   * and paid limits it no longer had.
   *
   * The policy itself is asserted directly, since that is importable. The
   * wiring around it is asserted from source: xbarStoreHelpers.ts uses
   * extensionless `@/` imports that do not resolve under tsconfig.test.json's
   * NodeNext resolution, so it is not part of this compilation — which is why
   * backupFiles.test.ts reaches restorePersistedState the same way.
   */
  const lapsed = clampSubscriptionToEntitlement({
    tier: 'Ranch Ops',
    purchasedTier: 'Ranch Ops',
    billingState: 'Inactive',
  } as SubscriptionProfile);
  assert.notEqual(lapsed.tier, 'Ranch Ops', 'an inactive workspace must not keep the tier it stopped paying for');
  assert.equal(lapsed.purchasedTier, 'Ranch Ops', 'but what they bought is still what they bought');

  const helpers = await readFile(path.resolve(process.cwd(), 'src/store/xbarStoreHelpers.ts'), 'utf8');
  assert.match(
    helpers,
    /const entitledSubscription = clampSubscriptionToEntitlement\(subscription\);/,
    'restorePersistedState must be where that policy is applied to a rehydrate',
  );

  const store = await readFile(path.resolve(process.cwd(), 'src/store/useXbarStore.ts'), 'utf8');
  assert.match(
    store,
    /version: WORKSPACE_SCHEMA_VERSION,\s*migrate: \(persistedState\) => restorePersistedState\(persistedState\),/,
    'the persist config must route the migration through restorePersistedState',
  );

  /*
   * Version 8 shipped on main. At or below it, `migrate` never fires for an
   * existing install and everything above is dead code in practice.
   *
   * Read from source rather than imported for the module reason above — and the
   * regex is anchored to the declaration so a number in a comment cannot
   * satisfy it.
   */
  const declared = helpers.match(/export const WORKSPACE_SCHEMA_VERSION = (\d+);/);
  assert.ok(declared, 'WORKSPACE_SCHEMA_VERSION must be a plain numeric literal so this check can read it');
  assert.ok(
    Number(declared[1]) > 8,
    `WORKSPACE_SCHEMA_VERSION is ${declared[1]}; version 8 is already on disk for every existing install, so migrate would never run`,
  );
});

test('every writer of the schema version reads the same constant', async () => {
  // cloudWorkspace.ts hardcoded `version: 8`. It would have gone on claiming 8
  // after the bump, so a cloud snapshot imported as already-current and skipped
  // the normalization the bump exists to run — the same defect as never
  // bumping, reachable only through the cloud path.
  for (const file of ['src/lib/cloudWorkspace.ts', 'src/store/useXbarStore.ts']) {
    const source = await readFile(path.resolve(process.cwd(), file), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /version: \d+/, `${file} must not write a literal schema version`);
    assert.match(code, /version: WORKSPACE_SCHEMA_VERSION/, `${file} must write the shared constant`);
  }
});

test('an expired marker on the destination does not shut out a live one', async () => {
  /*
   * `readPendingHostedPurchase` returns anything parseable; the 24-hour window
   * is applied by `isPendingHostedPurchase`, and the migration used the wrong
   * one of the two. So a workspace carrying an abandoned marker from weeks ago
   * kept it, the recent purchase's marker was cleared from the local scope, and
   * the guard was left holding a record that reads inactive — checkout reopened
   * while a real payment-link purchase was still awaiting manual activation.
   * A duplicate charge, in exactly the case this function exists to prevent.
   */
  const harness = installClaimHarness(undefined);
  try {
    const longAgo = new Date('2026-08-01T04:00:00.000Z');
    const now = new Date('2026-09-02T04:00:01.000Z');

    // The destination's own marker, abandoned a month ago.
    await claimPendingHostedPurchase(claimFor('ws-new', 'Ranch', longAgo.toISOString()), longAgo, true);
    // The purchase the rancher actually just made, before signing in.
    await claimPendingHostedPurchase(claimFor('', 'Pro'), now, true);

    migratePendingHostedPurchase('', 'ws-new', now);

    const kept = readPendingHostedPurchase('ws-new');
    assert.equal(kept?.tier, 'Pro', 'the live purchase must win over an expired marker');
    assert.equal(
      kept?.startedAt,
      DEFAULT_CLAIM_STARTED_AT,
      'carrying its own start time across, not the abandoned marker’s and not a fresh stamp',
    );

    // Which is the point: the workspace is still held against a second charge.
    const again = await claimPendingHostedPurchase(claimFor('ws-new', 'Pro'), now, true);
    assert.equal(again.claimed, false, 'checkout must stay closed while that purchase is pending');
  } finally {
    harness.restore();
  }
});

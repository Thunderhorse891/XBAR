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
  isPendingHostedPurchase,
  parsePendingHostedPurchase,
  pendingHostedPurchaseNotice,
} from '../src/lib/pendingHostedPurchase.js';

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
  const pending = { tier: 'Professional' as const, startedAt: startedAt.toISOString() };

  assert.equal(isPendingHostedPurchase(pending, new Date('2026-09-02T03:05:00Z')), true);
  // Still pending most of a day later: a manual grant can wait for someone's
  // morning, and a second charge in the meantime is the thing being prevented.
  assert.equal(isPendingHostedPurchase(pending, new Date('2026-09-02T23:00:00Z')), true);
});

test('a started purchase does not lock the customer out forever', () => {
  /*
   * The over-rejection direction, and the one that costs a sale. Nothing here
   * can tell an ABANDONED checkout from an unconfirmed one, so the marker has
   * to expire — and the screen also offers an explicit way out, because the
   * person who knows they did not pay should not wait a day to say so.
   */
  const pending = { tier: 'Professional' as const, startedAt: '2026-09-01T03:00:00Z' };
  assert.equal(isPendingHostedPurchase(pending, new Date('2026-09-02T04:00:00Z')), false);
  assert.equal(isPendingHostedPurchase(null, new Date()), false);
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
  assert.deepEqual(
    parsePendingHostedPurchase(JSON.stringify({ tier: 'Professional', startedAt: '2026-09-02T03:00:00Z' })),
    {
      tier: 'Professional',
      startedAt: '2026-09-02T03:00:00Z',
    },
  );
});

test('a clock that moved backwards still counts as pending', () => {
  // A future timestamp is a clock change, not a purchase from tomorrow.
  // Reading it as pending is the answer that does not charge twice.
  const pending = { tier: 'Ranch Ops' as const, startedAt: '2026-09-03T03:00:00Z' };
  assert.equal(isPendingHostedPurchase(pending, new Date('2026-09-02T03:00:00Z')), true);
});

test('the notice says what is true here, not that the plan is active', () => {
  const notice = pendingHostedPurchaseNotice({ tier: 'Ranch Ops', startedAt: '2026-09-02T03:00:00Z' });

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
  const helperAt = screen.indexOf('const followPaymentLink = (');
  assert.ok(helperAt > -1, 'the single payment-link redirect must be findable');
  const helper = screen.slice(helperAt, screen.indexOf('const openBillingPortal', helperAt));
  assert.match(helper, /purchaseAwaitingActivation && pendingPurchase/, 'it must refuse a repeat');
  assert.match(helper, /localStorage\.setItem\(PENDING_HOSTED_PURCHASE_KEY/, 'and record the new one');
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
  assert.match(screen, /followPaymentLink\(tier, hostedOnlyLink\);/, 'the hosted-only route');
  assert.match(screen, /followPaymentLink\(tier, fallback, managed\.message\);/, 'and the no-identity fallback');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getCheckoutReadiness,
  clampSubscriptionToEntitlement,
  hasActivePaidPlan,
  isCurrentPaidPlan,
  isEntitledBillingState,
  planOutcomes,
  recommendedTier,
} from '../src/lib/subscriptionDecision.js';
import type { SubscriptionProfile, SubscriptionTier } from '../src/types/xbar.js';
import { subscriptionPlans } from '../src/lib/subscriptionPlans.js';

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
  const legacy = { tier: 'Starter', billingState: 'Inactive' } as Partial<SubscriptionProfile>;
  const readiness = getCheckoutReadiness({
    billingEnabled: true,
    canManageBilling: true,
    hasManagedIdentity: true,
    hasPaymentLink: true,
    checkoutInProgress: false,
    // The same expression Subscriptions.tsx uses.
    subscriptionRecoverable: legacy.subscriptionRecoverable === true,
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.mode, 'checkout');
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

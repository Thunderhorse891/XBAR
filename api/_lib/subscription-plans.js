import { BASELINE_TIER, billingStateForStripeStatus, entitledTierForBillingState } from './subscription-status.js';

export const subscriptionPlans = {
  Starter: {
    monthlyRate: 29,
    sharedAccessEnabled: false,
    featureFlags: [
      'Keep clean records — horses, care, documents, expenses, reminders',
      'Proof vault with OCR intake and review',
      '1 team seat',
      '250 document capacity · 25 GB storage',
    ],
    limits: {
      horseLimit: 5,
      seatLimit: 1,
      documentLimit: 250,
      salePacketLimit: 2,
      storageLimitGb: 25,
      sharedAccessSeatLimit: 0,
    },
  },
  Professional: {
    monthlyRate: 79,
    sharedAccessEnabled: true,
    featureFlags: [
      'Everything in Starter',
      'Make money: watermarked sale packets and buyer folders',
      'Sale listings — publish buyer-ready horse profiles to shared access',
      '5 team seats and 10 client seats',
      '1,000 document capacity · 100 GB storage',
    ],
    limits: {
      horseLimit: 30,
      seatLimit: 5,
      documentLimit: 1000,
      salePacketLimit: 30,
      storageLimitGb: 100,
      sharedAccessSeatLimit: 10,
    },
  },
  'Ranch Ops': {
    monthlyRate: 199,
    sharedAccessEnabled: true,
    featureFlags: [
      'Everything in Professional',
      'Run the operation: team roles, breeding program, equipment at scale',
      '20 team seats and 40 client seats',
      '5,000 document capacity · 500 GB storage',
    ],
    limits: {
      horseLimit: 200,
      seatLimit: 20,
      documentLimit: 5000,
      salePacketLimit: 250,
      storageLimitGb: 500,
      sharedAccessSeatLimit: 40,
    },
  },
  Enterprise: {
    monthlyRate: 499,
    sharedAccessEnabled: true,
    featureFlags: [
      'Everything in Ranch Ops',
      'Scale and control for large rosters and teams',
      '60 team seats and 200 client seats',
      '20,000 document capacity · 2,500 GB storage',
    ],
    limits: {
      horseLimit: 2000,
      seatLimit: 60,
      documentLimit: 20000,
      salePacketLimit: 2000,
      storageLimitGb: 2500,
      sharedAccessSeatLimit: 200,
    },
  },
};

export function getStripePriceIdByTier(tier) {
  const envMap = {
    Starter: process.env.STRIPE_PRICE_ID_STARTER || '',
    Professional: process.env.STRIPE_PRICE_ID_PROFESSIONAL || '',
    'Ranch Ops': process.env.STRIPE_PRICE_ID_RANCH_OPS || '',
    Enterprise: process.env.STRIPE_PRICE_ID_ENTERPRISE || '',
  };

  return envMap[tier] || '';
}

/**
 * Resolve a Stripe price id to a tier, or null when it matches none.
 *
 * An empty price id never matches, even when a tier's STRIPE_PRICE_ID_* env var
 * is also unset — otherwise an unconfigured deployment would resolve every
 * unknown price to whichever tier happened to be blank.
 */
export function findTierByPriceId(priceId) {
  const normalized = String(priceId ?? '').trim();
  if (!normalized) return null;
  return Object.keys(subscriptionPlans).find((tier) => getStripePriceIdByTier(tier) === normalized) || null;
}

/** Retained name; the decision itself lives in subscription-status.js. */
export function normalizeBillingState(status) {
  return billingStateForStripeStatus(status);
}

/** True when `tier` is a plan this build actually sells. */
export function isKnownTier(tier) {
  return typeof tier === 'string' && Object.prototype.hasOwnProperty.call(subscriptionPlans, tier);
}

/**
 * Build a stored subscription profile.
 *
 * An unrecognized tier resolves to the baseline rather than being trusted, and
 * says so via `tierRecognized: false`. It used to be silently rewritten to
 * Starter, which made a bad tier string indistinguishable from a real Starter
 * subscription — the profile looked correct and nothing recorded that a value
 * had been discarded.
 */
export function buildSubscriptionProfile(params) {
  const tierRecognized = isKnownTier(params.tier);
  const purchasedTier = tierRecognized ? params.tier : BASELINE_TIER;
  const billingState = billingStateForStripeStatus(params.billingStatus);

  // Every entitlement field below comes from the tier the workspace is actually
  // entitled to right now, not the one it bought.
  //
  // This payload is what the client stores and gates on, and the client gates
  // read `tier`, `sharedAccessEnabled` and the usage limits — none of them look
  // at billingState. Copying the purchased tier's values into a canceled or
  // unpaid workspace's payload therefore left it rendering paid features and
  // passing local gates while the API and the database both enforced Starter.
  //
  // `purchasedTier` keeps what was bought, so billing screens can say which
  // plan lapsed and recovery has something to restore. It is deliberately not
  // what anything gates on.
  const tier = entitledTierForBillingState(purchasedTier, billingState);
  const plan = subscriptionPlans[tier];
  const existingUsage = params.existingUsage || {};
  const renewalDate = params.renewalDate || '';

  return {
    tier,
    purchasedTier,
    tierRecognized,
    // The price of the plan that was bought, not of the fallback entitlement.
    // Quoting Starter's rate to a canceled Enterprise workspace would imply a
    // charge that is not happening; billingState is what says whether anything
    // is being billed at all.
    monthlyRate: subscriptionPlans[purchasedTier].monthlyRate,
    renewalDate,
    billingState,
    sharedAccessEnabled: plan.sharedAccessEnabled,
    featureFlags: plan.featureFlags,
    usage: {
      horsesUsed: Number(existingUsage.horsesUsed || 0),
      horseLimit: plan.limits.horseLimit,
      seatsUsed: Number(existingUsage.seatsUsed || 0),
      seatLimit: plan.limits.seatLimit,
      documentsProcessed: Number(existingUsage.documentsProcessed || 0),
      documentLimit: plan.limits.documentLimit,
      salePacketsGenerated: Number(existingUsage.salePacketsGenerated || 0),
      salePacketLimit: plan.limits.salePacketLimit,
      storageUsedGb: Number(existingUsage.storageUsedGb || 0),
      storageLimitGb: plan.limits.storageLimitGb,
      sharedAccessSeatsUsed: Number(existingUsage.sharedAccessSeatsUsed || 0),
      sharedAccessSeatLimit: plan.limits.sharedAccessSeatLimit,
    },
  };
}

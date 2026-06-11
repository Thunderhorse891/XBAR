export const subscriptionPlans = {
  Starter: {
    monthlyRate: 29,
    sharedAccessEnabled: false,
    brandedListings: false,
    featureFlags: [
      'Keep clean records — horses, care, documents, expenses, reminders',
      'Proof vault with OCR intake and review',
      '1 team seat',
      '250 document capacity · 25 GB storage',
    ],
    limits: {
      seatLimit: 1,
      documentLimit: 250,
      storageLimitGb: 25,
      sharedAccessSeatLimit: 0,
    },
  },
  Professional: {
    monthlyRate: 79,
    sharedAccessEnabled: true,
    brandedListings: true,
    featureFlags: [
      'Everything in Starter',
      'Make money: watermarked sale packets and buyer deal rooms',
      'Sale listings — publish buyer-ready horse profiles to shared access',
      '5 team seats · 10 shared-access seats',
      '1,000 document capacity · 100 GB storage',
    ],
    limits: {
      seatLimit: 5,
      documentLimit: 1000,
      storageLimitGb: 100,
      sharedAccessSeatLimit: 10,
    },
  },
  'Ranch Ops': {
    monthlyRate: 199,
    sharedAccessEnabled: true,
    brandedListings: true,
    featureFlags: [
      'Everything in Professional',
      'Run the operation: team roles, breeding program, equipment at scale',
      '20 team seats · 40 shared-access seats',
      '5,000 document capacity · 500 GB storage',
    ],
    limits: {
      seatLimit: 20,
      documentLimit: 5000,
      storageLimitGb: 500,
      sharedAccessSeatLimit: 40,
    },
  },
  Enterprise: {
    monthlyRate: 499,
    sharedAccessEnabled: true,
    brandedListings: true,
    featureFlags: [
      'Everything in Ranch Ops',
      'Scale and control for large rosters and teams',
      '60 team seats · 200 shared-access seats',
      '20,000 document capacity · 2,500 GB storage',
    ],
    limits: {
      seatLimit: 60,
      documentLimit: 20000,
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

export function findTierByPriceId(priceId) {
  return Object.keys(subscriptionPlans).find((tier) => getStripePriceIdByTier(tier) === priceId) || null;
}

export function normalizeBillingState(status) {
  if (status === 'active' || status === 'trialing') {
    return 'Active';
  }

  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete_expired') {
    return 'Past Due';
  }

  return 'Manual Billing';
}

export function buildSubscriptionProfile(params) {
  const tier = params.tier in subscriptionPlans ? params.tier : 'Starter';
  const plan = subscriptionPlans[tier];
  const existingUsage = params.existingUsage || {};
  const renewalDate = params.renewalDate || '';

  return {
    tier,
    monthlyRate: plan.monthlyRate,
    renewalDate,
    billingState: normalizeBillingState(params.billingStatus),
    sharedAccessEnabled: plan.sharedAccessEnabled,
    brandedListings: plan.brandedListings,
    featureFlags: plan.featureFlags,
    usage: {
      seatsUsed: Number(existingUsage.seatsUsed || 0),
      seatLimit: plan.limits.seatLimit,
      documentsProcessed: Number(existingUsage.documentsProcessed || 0),
      documentLimit: plan.limits.documentLimit,
      storageUsedGb: Number(existingUsage.storageUsedGb || 0),
      storageLimitGb: plan.limits.storageLimitGb,
      sharedAccessSeatsUsed: Number(existingUsage.sharedAccessSeatsUsed || 0),
      sharedAccessSeatLimit: plan.limits.sharedAccessSeatLimit,
    },
  };
}

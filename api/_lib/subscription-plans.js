export const subscriptionPlans = {
  Starter: {
    monthlyRate: 29,
    sharedAccessEnabled: false,
    brandedListings: false,
    featureFlags: [
      'Horse command files',
      'Health expiry alerts',
      'Expense ledger',
      'Proof vault',
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
    brandedListings: true,
    featureFlags: [
      'Everything in Starter',
      'Owner and buyer sharing',
      'Scheduling workflow',
      'Client communication controls',
      'Role-based team access',
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
    brandedListings: true,
    featureFlags: [
      'Everything in Professional',
      'Business management',
      'Inventory and supply control',
      'Breeding and foaling operations',
      'Activity accountability',
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
    brandedListings: true,
    featureFlags: [
      'Everything in Ranch Ops',
      'Enterprise permissions',
      'Data portability',
      'Advanced automation roadmap',
      'Priority implementation path',
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

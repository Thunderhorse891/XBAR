// Supported public plans and monthly amounts come from the checkout catalog.
// Legacy entitlements remain in subscription-plans; they are not new-sale offers.
import publicPlanCatalog from '../../api/_lib/public-plan-catalog.json' with { type: 'json' };

const details = {
  Professional: {
    featured: true,
    fit: 'For active breeding and sale businesses that need stronger workflows.',
    features: [
      'Horse records and document OCR',
      'Share approved sale packets and keep buyer follow-up in one place',
      'Sale listings for buyer-ready horse profiles',
      '5 team seats and 10 client seats',
      'Up to 1,000 active documents',
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
    fit: 'For multi-user operations with significant record volume.',
    features: [
      'Everything in Professional',
      'Run the operation: team roles, breeding, equipment, and supplies',
      '20 team seats and 40 client seats',
      'Up to 5,000 active documents',
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
};

export const marketingPlans = Object.entries(publicPlanCatalog).map(([tier, { monthlyCents }]) => ({
  ...details[tier],
  tier,
  monthlyRate: monthlyCents / 100,
}));

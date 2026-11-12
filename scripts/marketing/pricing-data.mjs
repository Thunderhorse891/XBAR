// Public pricing data rendered on the static marketing site.
//
// This mirrors `subscriptionTierConfig` in src/lib/xbarRuntime.ts (the tier
// config cannot be imported here because its module graph uses .js-suffixed
// TS imports that Node cannot resolve outside the bundler). The unit test
// tests/marketingSite.test.ts fails the build if the two ever drift, so the
// numbers published on /pricing are always the numbers the app enforces.

export const marketingPlans = [
  {
    tier: 'Free',
    monthlyRate: 0,
    annualRate: 0,
    fit: 'For a private owner starting with 2 horses and 1 user.',
    features: [
      '2 horses and 1 user',
      'Manual document upload',
      '1 seat, 10 documents',
      'Limited cloud storage shared across XBAR at launch',
      'No card required',
      'No OCR or shared sale packets',
    ],
    limits: {
      horseLimit: 2,
      seatLimit: 1,
      documentLimit: 10,
      salePacketLimit: 0,
      storageLimitGb: 1,
      sharedAccessSeatLimit: 0,
    },
  },
  {
    tier: 'Professional',
    monthlyRate: 20,
    annualRate: 290,
    featured: true,
    fit: 'For active breeding and sale businesses that need stronger workflows.',
    features: [
      'Horse records with OCR intake and review',
      'Reports calculated automatically from records; export PDF or CSV manually',
      'Share approved sale packets and keep buyer follow-up in one place',
      'Sale listings for buyer-ready horse profiles',
      '5 team seats and 10 client seats',
      '1,000 documents',
      'Limited cloud storage shared across XBAR at launch',
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
  {
    tier: 'Ranch Ops',
    monthlyRate: 49.99,
    annualRate: 790,
    fit: 'For multi-user operations with significant record volume.',
    features: [
      'Everything in Professional',
      'Run the operation: team roles, breeding, equipment, and supplies',
      '20 team seats and 40 client seats',
      '5,000 documents',
      'Limited cloud storage shared across XBAR at launch',
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
];

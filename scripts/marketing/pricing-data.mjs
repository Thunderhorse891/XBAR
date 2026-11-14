// Public pricing data rendered on the static marketing site.
//
// This mirrors `subscriptionTierConfig` in src/lib/xbarRuntime.ts (the tier
// config cannot be imported here because its module graph uses .js-suffixed
// TS imports that Node cannot resolve outside the bundler). The unit test
// tests/marketingSite.test.ts fails the build if the two ever drift, so the
// numbers published on /pricing are always the numbers the app enforces.

export const marketingPlans = [
  {
    tier: 'Professional',
    monthlyRate: 19.99,
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
  {
    tier: 'Ranch Ops',
    monthlyRate: 49.99,
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
];

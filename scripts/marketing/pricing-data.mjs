// Public pricing data rendered on the static marketing site.
//
// This mirrors `subscriptionTierConfig` in src/lib/xbarRuntime.ts (the tier
// config cannot be imported here because its module graph uses .js-suffixed
// TS imports that Node cannot resolve outside the bundler). The unit test
// tests/marketingSite.test.ts fails the build if the two ever drift, so the
// numbers published on /pricing are always the numbers the app enforces.

export const marketingPlans = [
  {
    tier: 'Starter',
    monthlyRate: 29,
    fit: 'For smaller records-driven operations getting out of spreadsheets.',
    features: [
      'Keep clean records — horses, care, documents, expenses, reminders',
      'Documents with OCR intake and review',
      '1 team seat',
      '250 documents and 25 GB storage',
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
  {
    tier: 'Professional',
    monthlyRate: 79,
    featured: true,
    fit: 'For active breeding and sale businesses that need stronger workflows.',
    features: [
      'Everything in Starter',
      'Share approved sale packets and keep buyer follow-up in one place',
      'Sale listings for buyer-ready horse profiles',
      '5 team seats and 10 buyer seats',
      '1,000 documents and 100 GB storage',
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
    monthlyRate: 199,
    fit: 'For multi-user operations with significant record volume.',
    features: [
      'Everything in Professional',
      'Run the operation: team roles, breeding, equipment, and supplies',
      '20 team seats and 40 buyer seats',
      '5,000 documents and 500 GB storage',
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
  {
    tier: 'Enterprise',
    monthlyRate: 499,
    fit: 'For larger businesses that need the highest operating capacity.',
    features: [
      'Everything in Ranch Ops',
      'Scale and control for large rosters and teams',
      '60 team seats and 200 buyer seats',
      '20,000 documents and 2,500 GB storage',
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
];

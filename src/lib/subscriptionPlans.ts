import { subscriptionTierConfig } from './xbarRuntime.js';

subscriptionTierConfig.Enterprise.featureFlags = [
  'Everything in Ranch Ops',
  '60 team seats',
  '20,000 document capacity',
  '2,500 GB storage',
  '200 shared-access seats',
];

export const subscriptionPlans = subscriptionTierConfig;

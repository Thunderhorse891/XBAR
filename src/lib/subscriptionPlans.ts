import { subscriptionTierConfig } from './xbarRuntime.js';

export const subscriptionPlans = {
  ...subscriptionTierConfig,
  Enterprise: {
    ...subscriptionTierConfig.Enterprise,
    featureFlags: [
      'Everything in Ranch Ops',
      '60 team seats',
      'Dedicated onboarding',
      'Workspace audit log',
      'White-label buyer profiles',
    ],
  },
};

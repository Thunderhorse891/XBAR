import type { SubscriptionTier } from '../types/xbar.js';

/** Plans sold to new customers. Legacy entitlement tiers remain valid separately. */
export const publicPlanTiers = ['Free', 'Professional', 'Ranch Ops'] as const;
export const publicPaidPlanTiers = ['Professional', 'Ranch Ops'] as const;
export type PublicPaidPlanTier = (typeof publicPaidPlanTiers)[number];

export function isPublicPaidPlan(tier: SubscriptionTier | undefined): tier is PublicPaidPlanTier {
  return tier === 'Professional' || tier === 'Ranch Ops';
}

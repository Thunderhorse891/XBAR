import type { SubscriptionTier } from '../types/xbar.js';
import publicPlanCatalog from '../../api/_lib/public-plan-catalog.json' with { type: 'json' };

/** Plans sold to new customers. Legacy entitlement tiers remain valid separately. */
export type PublicPaidPlanTier = keyof typeof publicPlanCatalog;
export const publicPaidPlanTiers = Object.freeze(Object.keys(publicPlanCatalog) as PublicPaidPlanTier[]);
export const publicPlanTiers = ['Free', ...publicPaidPlanTiers] as const;

export function isPublicPaidPlan(tier: SubscriptionTier | undefined): tier is PublicPaidPlanTier {
  return Boolean(tier && Object.prototype.hasOwnProperty.call(publicPlanCatalog, tier));
}

import type { SubscriptionTier } from '../types/xbar.js';

export const billingPath = '/billing';
export const legacyBillingPaths = ['/plans', '/subscribe', '/subscriptions'] as const;

export function billingPathForTier(tier?: SubscriptionTier | string) {
  return tier ? `${billingPath}?plan=${encodeURIComponent(tier)}` : billingPath;
}

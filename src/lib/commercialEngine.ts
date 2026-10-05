import type { SubscriptionProfile, SubscriptionTier } from '../types/xbar.js';

export type CommercialFeature =
  'buyerDealRoom' | 'packetExport' | 'teamInvites' | 'profitIntelligence' | 'breedingRevenue' | 'ranchOps';

export type UsagePressure = 'clear' | 'warning' | 'upgrade' | 'blocked';

const planOrder: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];
const minimumPlanByFeature: Record<CommercialFeature, SubscriptionTier> = {
  buyerDealRoom: 'Professional',
  packetExport: 'Professional',
  teamInvites: 'Professional',
  profitIntelligence: 'Ranch Ops',
  breedingRevenue: 'Ranch Ops',
  ranchOps: 'Ranch Ops',
};

export function planRank(tier: SubscriptionTier) {
  return planOrder.indexOf(tier);
}

export function featureGate(subscription: SubscriptionProfile, feature: CommercialFeature) {
  const required = minimumPlanByFeature[feature];
  return planRank(subscription.tier) >= planRank(required)
    ? null
    : `${required} unlocks ${featureLabel(feature)}. Upgrade to keep this workflow moving.`;
}

export function featureLabel(feature: CommercialFeature) {
  if (feature === 'buyerDealRoom') return 'buyer follow-up';
  if (feature === 'packetExport') return 'sale document export';
  if (feature === 'teamInvites') return 'team invitations';
  if (feature === 'profitIntelligence') return 'profit intelligence';
  if (feature === 'breedingRevenue') return 'breeding revenue workflows';
  return 'Ranch Ops workflows';
}

export function usagePressure(used: number, limit: number): UsagePressure {
  if (limit <= 0 || used >= limit) return 'blocked';
  const percent = (used / limit) * 100;
  if (percent >= 90) return 'upgrade';
  if (percent >= 80) return 'warning';
  return 'clear';
}

export function usageGate(label: string, used: number, limit: number, incoming = 1) {
  return used + incoming <= limit
    ? null
    : `${label} limit reached (${used}/${limit}). Upgrade to unlock more capacity.`;
}

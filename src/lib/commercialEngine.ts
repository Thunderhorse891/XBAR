import type { SubscriptionProfile, SubscriptionTier } from '../types/xbar.js';

export type CommercialFeature =
  | 'buyerDealRoom'
  | 'packetExport'
  | 'teamInvites'
  | 'profitIntelligence'
  | 'breedingRevenue'
  | 'ranchOps';

export type UsagePressure = 'clear' | 'warning' | 'upgrade' | 'blocked';

export type UsageMeter = {
  key: 'horses' | 'documents' | 'salePackets' | 'seats';
  label: string;
  used: number;
  limit: number;
  percent: number;
  pressure: UsagePressure;
  message: string;
};

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

export function nextPlan(tier: SubscriptionTier) {
  return planOrder[Math.min(planOrder.length - 1, planRank(tier) + 1)];
}

export function featureGate(subscription: SubscriptionProfile, feature: CommercialFeature) {
  const required = minimumPlanByFeature[feature];
  return planRank(subscription.tier) >= planRank(required)
    ? null
    : `${required} unlocks ${featureLabel(feature)}. Upgrade to keep this workflow moving.`;
}

export function featureLabel(feature: CommercialFeature) {
  if (feature === 'buyerDealRoom') return 'the Buyer Folder';
  if (feature === 'packetExport') return 'buyer packet export';
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

export function buildUsageMeters(subscription: SubscriptionProfile): UsageMeter[] {
  const usage = subscription.usage;
  const inputs: Array<Pick<UsageMeter, 'key' | 'label' | 'used' | 'limit'>> = [
    { key: 'horses', label: 'Horses', used: usage.horsesUsed, limit: usage.horseLimit },
    { key: 'documents', label: 'Documents', used: usage.documentsProcessed, limit: usage.documentLimit },
    { key: 'salePackets', label: 'Sale packets', used: usage.salePacketsGenerated, limit: usage.salePacketLimit },
    { key: 'seats', label: 'Team seats', used: usage.seatsUsed, limit: usage.seatLimit },
  ];

  return inputs.map((meter) => {
    const percent = meter.limit > 0 ? Math.min(100, Math.round((meter.used / meter.limit) * 100)) : 100;
    const pressure = usagePressure(meter.used, meter.limit);
    const message = pressure === 'blocked'
      ? `${meter.label} capacity is full. Upgrade to unlock the next action.`
      : pressure === 'upgrade'
        ? `${meter.label} usage is at ${percent}%. Upgrade before the workflow stops.`
        : pressure === 'warning'
          ? `${meter.label} usage is at ${percent}%. Plan capacity now.`
          : `${meter.limit - meter.used} ${meter.label.toLowerCase()} remaining.`;
    return { ...meter, percent, pressure, message };
  });
}

export function highestUsagePressure(subscription: SubscriptionProfile) {
  const rank: Record<UsagePressure, number> = { clear: 0, warning: 1, upgrade: 2, blocked: 3 };
  return buildUsageMeters(subscription).sort((left, right) => rank[right.pressure] - rank[left.pressure] || right.percent - left.percent)[0];
}

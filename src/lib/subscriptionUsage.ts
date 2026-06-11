import { subscriptionPlans } from './subscriptionPlans.js';
import type { SubscriptionProfile, SubscriptionTier } from '../types/xbar.js';

export type UsageMeterKey = 'horses' | 'documents' | 'salePackets' | 'seats' | 'storage' | 'sharedAccessSeats';
export type UsagePressureLevel = 'clear' | 'warning' | 'upgrade' | 'hardGate';
export type UsageTone = 'blue' | 'slate' | 'emerald' | 'amber' | 'rose';

export type SubscriptionCapacity = {
  horseLimit: number;
  documentLimit: number;
  salePacketLimit: number;
  seatLimit: number;
  storageLimitGb: number;
  sharedAccessSeatLimit: number;
};

export type UsageMeter = {
  key: UsageMeterKey;
  label: string;
  used: number;
  limit: number;
  unit?: string;
  percent: number;
  level: UsagePressureLevel;
  upgradeTier: SubscriptionTier;
  nextAction: string;
};

export type UsageMeterInput = {
  subscription: SubscriptionProfile;
  horsesUsed: number;
  documentsUsed: number;
  salePacketsGenerated: number;
  seatsUsed?: number;
  storageUsedGb?: number;
  sharedAccessSeatsUsed?: number;
};

export type UpgradePressure = {
  level: UsagePressureLevel;
  headline: string;
  message: string;
  ctaTier: SubscriptionTier;
  blocker?: UsageMeter;
};

const tierOrder: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

const revenueLimits: Record<SubscriptionTier, Pick<SubscriptionCapacity, 'horseLimit' | 'salePacketLimit'>> = {
  Starter: {
    horseLimit: 25,
    salePacketLimit: 10,
  },
  Professional: {
    horseLimit: 100,
    salePacketLimit: 75,
  },
  'Ranch Ops': {
    horseLimit: 500,
    salePacketLimit: 300,
  },
  Enterprise: {
    horseLimit: 2000,
    salePacketLimit: 1200,
  },
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function usagePercent(used: number, limit: number) {
  if (limit <= 0) return used > 0 ? 100 : 0;
  return clampPercent((used / limit) * 100);
}

export function getPlanCapacity(tier: SubscriptionTier): SubscriptionCapacity {
  const plan = subscriptionPlans[tier];
  return {
    horseLimit: revenueLimits[tier].horseLimit,
    documentLimit: plan.limits.documentLimit,
    salePacketLimit: revenueLimits[tier].salePacketLimit,
    seatLimit: plan.limits.seatLimit,
    storageLimitGb: plan.limits.storageLimitGb,
    sharedAccessSeatLimit: plan.limits.sharedAccessSeatLimit,
  };
}

export function getNextSubscriptionTier(tier: SubscriptionTier): SubscriptionTier {
  const index = tierOrder.indexOf(tier);
  return tierOrder[Math.min(tierOrder.length - 1, Math.max(0, index + 1))];
}

export function getUpgradePath(tier: SubscriptionTier) {
  return `/subscriptions?plan=${encodeURIComponent(tier)}`;
}

export function getUsagePressureLevel(used: number, limit: number): UsagePressureLevel {
  if (limit <= 0) return used > 0 ? 'hardGate' : 'clear';
  const percent = (used / limit) * 100;
  if (percent >= 100) return 'hardGate';
  if (percent >= 90) return 'upgrade';
  if (percent >= 80) return 'warning';
  return 'clear';
}

export function usageMeterTone(level: UsagePressureLevel): UsageTone {
  if (level === 'hardGate') return 'rose';
  if (level === 'upgrade' || level === 'warning') return 'amber';
  return 'blue';
}

export function formatUsageValue(value: number, unit = '') {
  const normalized = unit === 'GB' ? Math.round(value * 10) / 10 : Math.round(value);
  return `${normalized.toLocaleString()}${unit ? ` ${unit}` : ''}`;
}

function buildMeter(params: {
  key: UsageMeterKey;
  label: string;
  used: number;
  limit: number;
  unit?: string;
  tier: SubscriptionTier;
  nextAction: string;
}): UsageMeter {
  const level = getUsagePressureLevel(params.used, params.limit);
  return {
    ...params,
    percent: usagePercent(params.used, params.limit),
    level,
    upgradeTier: getNextSubscriptionTier(params.tier),
  };
}

export function buildUsageMeters(input: UsageMeterInput): UsageMeter[] {
  const capacity = getPlanCapacity(input.subscription.tier);
  return [
    buildMeter({
      key: 'horses',
      label: 'Horses',
      used: input.horsesUsed,
      limit: capacity.horseLimit,
      tier: input.subscription.tier,
      nextAction: 'Upgrade before adding more command files.',
    }),
    buildMeter({
      key: 'documents',
      label: 'Documents',
      used: input.documentsUsed,
      limit: capacity.documentLimit,
      tier: input.subscription.tier,
      nextAction: 'Upgrade before uploading more proof records.',
    }),
    buildMeter({
      key: 'salePackets',
      label: 'Sale packets',
      used: input.salePacketsGenerated,
      limit: capacity.salePacketLimit,
      tier: input.subscription.tier,
      nextAction: 'Upgrade before generating more buyer packets.',
    }),
    buildMeter({
      key: 'seats',
      label: 'Team seats',
      used: input.seatsUsed ?? input.subscription.usage.seatsUsed,
      limit: capacity.seatLimit,
      tier: input.subscription.tier,
      nextAction: 'Upgrade before inviting more team members.',
    }),
    buildMeter({
      key: 'storage',
      label: 'Storage',
      used: input.storageUsedGb ?? input.subscription.usage.storageUsedGb,
      limit: capacity.storageLimitGb,
      unit: 'GB',
      tier: input.subscription.tier,
      nextAction: 'Upgrade before adding larger files.',
    }),
    buildMeter({
      key: 'sharedAccessSeats',
      label: 'Buyer access seats',
      used: input.sharedAccessSeatsUsed ?? input.subscription.usage.sharedAccessSeatsUsed,
      limit: capacity.sharedAccessSeatLimit,
      tier: input.subscription.tier,
      nextAction: 'Upgrade before expanding buyer or owner access.',
    }),
  ];
}

const pressureRank: Record<UsagePressureLevel, number> = {
  clear: 0,
  warning: 1,
  upgrade: 2,
  hardGate: 3,
};

export function buildUpgradePressure(subscription: SubscriptionProfile, meters: UsageMeter[]): UpgradePressure {
  const blocker = [...meters].sort((left, right) => pressureRank[right.level] - pressureRank[left.level] || right.percent - left.percent)[0];
  const nextTier = getNextSubscriptionTier(subscription.tier);

  if (!blocker || blocker.level === 'clear') {
    return {
      level: 'clear',
      headline: 'Plan capacity is healthy.',
      message: `${subscription.tier} still has operating room. Keep adding records until a meter reaches 80%.`,
      ctaTier: nextTier,
    };
  }

  if (blocker.level === 'hardGate') {
    return {
      level: 'hardGate',
      headline: `${blocker.label} limit reached.`,
      message: `${subscription.tier} is at ${formatUsageValue(blocker.used, blocker.unit)} of ${formatUsageValue(blocker.limit, blocker.unit)}. ${blocker.nextAction}`,
      ctaTier: blocker.upgradeTier,
      blocker,
    };
  }

  if (blocker.level === 'upgrade') {
    return {
      level: 'upgrade',
      headline: `${blocker.label} is over 90%.`,
      message: `${subscription.tier} is close to a hard gate. Upgrade now instead of blocking a revenue workflow mid-sale.`,
      ctaTier: blocker.upgradeTier,
      blocker,
    };
  }

  return {
    level: 'warning',
    headline: `${blocker.label} is over 80%.`,
    message: 'Capacity pressure is building. Start the upgrade decision before uploads, seats, or buyer packets get blocked.',
    ctaTier: blocker.upgradeTier,
    blocker,
  };
}

export function horseLimitGate(subscription: SubscriptionProfile, currentHorseCount: number, incomingHorseCount = 1) {
  const capacity = getPlanCapacity(subscription.tier);
  const nextCount = currentHorseCount + incomingHorseCount;
  return nextCount <= capacity.horseLimit
    ? null
    : `This would exceed the ${capacity.horseLimit.toLocaleString()} horse limit for ${subscription.tier}. Upgrade to ${getNextSubscriptionTier(subscription.tier)} before adding more command files.`;
}

export function salePacketLimitGate(subscription: SubscriptionProfile, currentPacketCount: number, incomingPacketCount = 1) {
  const capacity = getPlanCapacity(subscription.tier);
  const nextCount = currentPacketCount + incomingPacketCount;
  return nextCount <= capacity.salePacketLimit
    ? null
    : `This would exceed the ${capacity.salePacketLimit.toLocaleString()} sale packet limit for ${subscription.tier}. Upgrade to ${getNextSubscriptionTier(subscription.tier)} before generating more buyer packets.`;
}

export function documentLimitGate(subscription: SubscriptionProfile, currentDocumentCount: number, incomingDocumentCount: number) {
  const capacity = getPlanCapacity(subscription.tier);
  const nextCount = currentDocumentCount + incomingDocumentCount;
  return nextCount <= capacity.documentLimit
    ? null
    : `This upload would exceed the ${capacity.documentLimit.toLocaleString()} document limit for ${subscription.tier}. Upgrade to ${getNextSubscriptionTier(subscription.tier)} or remove documents before uploading.`;
}

import type { SubscriptionProfile } from '../types/xbar.js';
import { featureGate, usageGate } from './commercialEngine.js';

export const subscriptionUpgradePath = '/subscriptions';

export function sharedListingGate(subscription: SubscriptionProfile) {
  return subscription.sharedAccessEnabled
    ? null
    : 'Sale listings are available on Professional and higher plans. Upgrade to publish buyer-ready horse profiles.';
}

export function documentIntakeGate(subscription: SubscriptionProfile, currentDocumentCount: number, incomingDocumentCount: number) {
  const nextCount = currentDocumentCount + incomingDocumentCount;
  return nextCount <= subscription.usage.documentLimit
    ? null
    : `This upload would exceed the ${subscription.usage.documentLimit.toLocaleString()} document limit for ${subscription.tier}. Upgrade or remove documents before uploading.`;
}

export function horseCreationGate(subscription: SubscriptionProfile, currentHorseCount: number) {
  return usageGate('Horse', currentHorseCount, subscription.usage.horseLimit);
}

export function packetExportGate(subscription: SubscriptionProfile) {
  return featureGate(subscription, 'packetExport')
    ?? usageGate('Sale packet', subscription.usage.salePacketsGenerated, subscription.usage.salePacketLimit);
}

export function teamInviteGate(subscription: SubscriptionProfile) {
  return featureGate(subscription, 'teamInvites')
    ?? usageGate('Team seat', subscription.usage.seatsUsed, subscription.usage.seatLimit);
}

export function breedingRevenueGate(subscription: SubscriptionProfile) {
  return featureGate(subscription, 'breedingRevenue');
}

export function profitIntelligenceGate(subscription: SubscriptionProfile) {
  return featureGate(subscription, 'profitIntelligence');
}

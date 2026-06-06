import type { SubscriptionProfile } from '../types/xbar.js';

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

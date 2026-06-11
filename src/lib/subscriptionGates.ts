import { documentLimitGate, horseLimitGate, salePacketLimitGate } from './subscriptionUsage.js';
import type { SubscriptionProfile } from '../types/xbar.js';

export const subscriptionUpgradePath = '/subscriptions';

export function sharedListingGate(subscription: SubscriptionProfile) {
  return subscription.sharedAccessEnabled
    ? null
    : 'Sale listings are available on Professional and higher plans. Upgrade to publish buyer-ready horse profiles.';
}

export function documentIntakeGate(subscription: SubscriptionProfile, currentDocumentCount: number, incomingDocumentCount: number) {
  return documentLimitGate(subscription, currentDocumentCount, incomingDocumentCount);
}

export { horseLimitGate, salePacketLimitGate };

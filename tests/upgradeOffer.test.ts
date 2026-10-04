import assert from 'node:assert/strict';
import {
  validUpgradeOffer,
  upgradePriceDisclosure,
  UPGRADE_FEATURES,
  type UpgradeOffer,
} from '../src/lib/upgradeOffer.js';
import { featureGate, planRank, type CommercialFeature } from '../src/lib/commercialEngine.js';
import type { SubscriptionProfile } from '../src/types/xbar.js';

const offer: UpgradeOffer = {
  attemptId: 'attempt-2',
  feature: 'profitIntelligence',
  targetTier: 'Ranch Ops',
  billingPeriod: 'monthly',
  currency: 'USD',
  regularAmountCents: 7900,
  firstPeriodAmountCents: 7110,
  discountPercent: 10,
  checkoutAvailable: true,
};
assert.equal(validUpgradeOffer(offer, 'attempt-2', 'profitIntelligence'), true);
assert.equal(validUpgradeOffer(offer, 'attempt-1', 'profitIntelligence'), false);
assert.equal(validUpgradeOffer(offer, 'attempt-2', 'packetExport'), false);
for (const patch of [
  { targetTier: 'Enterprise' },
  { firstPeriodAmountCents: 7900 },
  { regularAmountCents: 0 },
  { discountPercent: 15 },
  { currency: 'EUR' },
  { billingPeriod: 'weekly' },
  { firstPeriodAmountCents: null },
  { regularAmountCents: null },
])
  assert.equal(validUpgradeOffer({ ...offer, ...patch }, 'attempt-2', 'profitIntelligence'), false);
assert.equal(
  validUpgradeOffer(
    { ...offer, checkoutAvailable: false, discountPercent: 0, firstPeriodAmountCents: null, regularAmountCents: null },
    'attempt-2',
    'profitIntelligence',
  ),
  true,
);
assert.match(upgradePriceDisclosure(offer), /\$71\.10 for the first month, then \$79\.00 per month/);
assert.match(
  upgradePriceDisclosure({
    ...offer,
    billingPeriod: 'annual',
    firstPeriodAmountCents: 71100,
    regularAmountCents: 79000,
  }),
  /\$711\.00 for the first year, then \$790\.00 per year/,
);
assert.match(upgradePriceDisclosure(offer), /Renews automatically until cancelled/);
const existingFeatures: CommercialFeature[] = [
  'buyerDealRoom',
  'packetExport',
  'teamInvites',
  'profitIntelligence',
  'breedingRevenue',
  'ranchOps',
];
for (const feature of existingFeatures) {
  for (const tier of ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'] as const) {
    assert.equal(
      featureGate({ tier } as SubscriptionProfile, feature) === null,
      planRank(tier) >= planRank(UPGRADE_FEATURES[feature].tier),
      `Offer must match the existing entitlement: ${tier}/${feature}`,
    );
  }
}
console.log('Upgrade offer: quote validation and first-period disclosure passed.');

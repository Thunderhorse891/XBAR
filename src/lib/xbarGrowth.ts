import { buildHorsePacketCompleteness } from './xbarPhaseTwo.js';
import { subscriptionTierConfig } from './xbarRuntime.js';
import type {
  DocumentRecord,
  HorseRecord,
  OCRBatch,
  OwnershipRecord,
  PortalSnapshot,
  RanchAsset,
  SalesLead,
  SubscriptionProfile,
  SubscriptionTier,
  WeatherSnapshot,
} from '../types/xbar.js';

type Tone = 'blue' | 'slate' | 'emerald' | 'amber' | 'rose';

export type CommandCenterItem = {
  id: string;
  title: string;
  summary: string;
  module: string;
  href: string;
  tone: Tone;
  value: string;
};

export type FieldToolCard = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  metric: string;
  href: string;
  tone: Tone;
};

export type RevenueScenario = {
  tier: SubscriptionTier;
  monthlyRate: number;
  annualContractValue: number;
  customersNeeded: number;
  summary: string;
};

export type RevenueBlueprint = {
  targetArr: number;
  currentArr: number;
  arrGap: number;
  customersNeededAtCurrentTier: number;
  recommendedMixArr: number;
  recommendedMixLabel: string;
  scenarios: RevenueScenario[];
  motions: string[];
};

const ARR_TARGET = 10_000_000;

function annualRecurringValue(monthlyRate: number) {
  return monthlyRate * 12;
}

function buyerReadyProfiles(horses: HorseRecord[], documents: DocumentRecord[], ownershipRecords: OwnershipRecord[]) {
  return horses.filter((horse) =>
    buildHorsePacketCompleteness(
      horse,
      documents.filter((document) => document.horseId === horse.id),
      ownershipRecords.find((record) => record.horseId === horse.id),
    ).buyerSafe,
  );
}

export function buildCommandCenter(params: {
  horses: HorseRecord[];
  documents: DocumentRecord[];
  ownershipRecords: OwnershipRecord[];
  salesLeads: SalesLead[];
  ranchAssets: RanchAsset[];
  weather: WeatherSnapshot;
  ocrBatches: OCRBatch[];
}) {
  const { horses, documents, ownershipRecords, salesLeads, ranchAssets, weather, ocrBatches } = params;

  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Extracting');
  const blockedProfiles = horses.filter((horse) => {
    const packet = buildHorsePacketCompleteness(
      horse,
      documents.filter((document) => document.horseId === horse.id),
      ownershipRecords.find((record) => record.horseId === horse.id),
    );
    return horse.sale.askPrice > 0 && packet.buyerProfileStatus === 'Blocked';
  });
  const activeOffers = salesLeads.filter((lead) => lead.stage === 'Offer' || lead.stage === 'Qualified');
  const ownershipAttention = ownershipRecords.filter((record) => record.transferStatus !== 'Clear');
  const serviceRisk = ranchAssets.filter((asset) => asset.condition === 'Attention Required' || asset.status === 'In Service');
  const slowBatches = ocrBatches.filter((batch) => batch.state !== 'Completed');

  const items: CommandCenterItem[] = [
    {
      id: 'ocr-review',
      title: `Clear ${reviewQueue.length} OCR review items`,
      summary: 'Move unresolved intake into buyer-safe records before trust drops or duplicates spread through the vault.',
      module: 'Documents',
      href: '/documents',
      tone: reviewQueue.length > 4 ? 'rose' : 'amber',
      value: reviewQueue.length ? `${reviewQueue.length} waiting` : 'Queue clear',
    },
    {
      id: 'buyer-blockers',
      title: `${blockedProfiles.length} revenue profiles blocked`,
      summary: 'Private sale horses are still missing the packet trust needed to convert buyers with confidence.',
      module: 'Sales',
      href: '/sales',
      tone: blockedProfiles.length ? 'rose' : 'emerald',
      value: blockedProfiles.length ? `${blockedProfiles.length} blocked` : 'All clear',
    },
    {
      id: 'ownership-integrity',
      title: `Resolve ${ownershipAttention.length} ownership issues`,
      summary: 'Transfer integrity is the wedge. Clearing these blockers protects revenue and differentiates XBAR from generic ranch tools.',
      module: 'Ownership',
      href: '/ownership',
      tone: ownershipAttention.length > 1 ? 'amber' : 'emerald',
      value: ownershipAttention.length ? `${ownershipAttention.length} open` : 'Clean ledger',
    },
    {
      id: 'buyer-pipeline',
      title: `Advance ${activeOffers.length} high-intent buyers`,
      summary: 'Qualified and offer-stage buyers should receive the strongest packet, fastest follow-up, and clean portal handoff.',
      module: 'Sales',
      href: '/portal',
      tone: activeOffers.length ? 'blue' : 'slate',
      value: activeOffers.length ? `${activeOffers.length} hot leads` : 'Pipeline cool',
    },
    {
      id: 'field-risk',
      title: weather.riskLevel === 'Stable' ? 'Field conditions stable' : 'Field operations need adjustment',
      summary: weather.riskLevel === 'Stable'
        ? 'No urgent weather-driven operational changes are needed right now.'
        : 'Tie turnout, transport, and breeding timing directly to weather posture so operations stay ahead of surprises.',
      module: 'Weather',
      href: '/weather',
      tone: weather.riskLevel === 'Action' ? 'rose' : weather.riskLevel === 'Watch' ? 'amber' : 'emerald',
      value: weather.riskLevel,
    },
    {
      id: 'ops-hardware',
      title: `${serviceRisk.length} ops tools need service`,
      summary: 'Scanners, kits, and field equipment directly affect document trust, treatment execution, and buyer readiness.',
      module: 'Ranch Toolkit',
      href: '/assets',
      tone: serviceRisk.length ? 'amber' : 'emerald',
      value: serviceRisk.length ? `${serviceRisk.length} flagged` : 'Tools ready',
    },
    {
      id: 'throughput',
      title: `${slowBatches.length} intake batches still moving`,
      summary: 'OCR throughput is a premium feature. Faster, cleaner review loops increase retention and justify higher plan pricing.',
      module: 'Documents',
      href: '/documents',
      tone: slowBatches.length > 1 ? 'blue' : 'slate',
      value: slowBatches.length ? `${slowBatches.length} active` : 'Throughput healthy',
    },
  ];

  return items
    .sort((left, right) => {
      const rank: Record<Tone, number> = { rose: 0, amber: 1, blue: 2, emerald: 3, slate: 4 };
      return rank[left.tone] - rank[right.tone];
    })
    .slice(0, 5);
}

export function buildFieldTools(params: {
  horses: HorseRecord[];
  documents: DocumentRecord[];
  ownershipRecords: OwnershipRecord[];
  salesLeads: SalesLead[];
  portal: PortalSnapshot;
  weather: WeatherSnapshot;
}) {
  const { horses, documents, ownershipRecords, salesLeads, portal, weather } = params;
  const buyerReady = buyerReadyProfiles(horses, documents, ownershipRecords).length;
  const unresolvedDocs = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Extracting').length;

  return [
    {
      id: 'scan-intake',
      eyebrow: 'Mobile capture',
      title: 'Scan to trusted record',
      summary: 'Phone-first intake should turn a document photo into a structured record, not a dead file upload.',
      metric: `${unresolvedDocs} docs still in review`,
      href: '/documents?upload=1',
      tone: unresolvedDocs ? 'amber' : 'emerald',
    },
    {
      id: 'horse-ops',
      eyebrow: 'Field workflow',
      title: 'Update horses from the barn, pasture, or trailer',
      summary: 'Location changes, care notes, media, and ownership evidence need to be fast enough for real ranch use on mobile.',
      metric: `${horses.length} active horse records`,
      href: '/horses',
      tone: 'blue',
    },
    {
      id: 'buyer-share',
      eyebrow: 'Revenue tool',
      title: 'Share buyer-safe profiles instantly',
      summary: 'The faster the team can send a trustworthy buyer packet, the harder it is for legacy tools to compete.',
      metric: `${buyerReady} buyer-safe profiles`,
      href: '/portal',
      tone: buyerReady ? 'emerald' : 'amber',
    },
    {
      id: 'weather-dispatch',
      eyebrow: 'Ranch control',
      title: 'Run weather-driven dispatch',
      summary: 'Turnout, transport, and breeding decisions should be driven by one live command surface, not text threads.',
      metric: `${weather.riskLevel} field posture`,
      href: '/weather',
      tone: weather.riskLevel === 'Action' ? 'rose' : weather.riskLevel === 'Watch' ? 'amber' : 'blue',
    },
    {
      id: 'lead-response',
      eyebrow: 'Pipeline motion',
      title: 'Respond before the buyer cools off',
      summary: 'High-value horses need premium packet follow-up that feels closer to a deal room than a listing website.',
      metric: `${salesLeads.filter((lead) => lead.stage !== 'Closed').length} open conversations`,
      href: '/sales',
      tone: 'blue',
    },
    {
      id: 'owner-experience',
      eyebrow: 'Subscriber value',
      title: 'Give owners a premium portal, not a login screen',
      summary: 'Portal trust, saved horses, and inquiry handoff should feel branded and high-touch so teams keep paying for the system.',
      metric: `${portal.activeOwners}/${portal.invitedOwners} active owners`,
      href: '/portal',
      tone: portal.activeOwners ? 'emerald' : 'slate',
    },
  ] satisfies FieldToolCard[];
}

export function buildRevenueBlueprint(subscription: SubscriptionProfile): RevenueBlueprint {
  const scenarios = (Object.entries(subscriptionTierConfig) as [SubscriptionTier, (typeof subscriptionTierConfig)[SubscriptionTier]][]).map(
    ([tier, config]) => {
      const annualContractValue = annualRecurringValue(config.monthlyRate);
      const customersNeeded = Math.ceil(ARR_TARGET / annualContractValue);
      return {
        tier,
        monthlyRate: config.monthlyRate,
        annualContractValue,
        customersNeeded,
        summary: `${customersNeeded} customers at ${tier} hits $10M ARR before setup fees and services.`,
      };
    },
  );

  const currentArr = annualRecurringValue(subscription.monthlyRate);
  const currentTierScenario = scenarios.find((scenario) => scenario.tier === subscription.tier) ?? scenarios[0];
  const recommendedMix = [
    { tier: 'Professional' as const, customers: 220 },
    { tier: 'Ranch Ops' as const, customers: 121 },
    { tier: 'Enterprise' as const, customers: 50 },
  ];
  const recommendedMixArr = recommendedMix.reduce(
    (sum, item) => sum + annualRecurringValue(subscriptionTierConfig[item.tier].monthlyRate) * item.customers,
    0,
  );

  return {
    targetArr: ARR_TARGET,
    currentArr,
    arrGap: Math.max(0, ARR_TARGET - currentArr),
    customersNeededAtCurrentTier: currentTierScenario.customersNeeded,
    recommendedMixArr,
    recommendedMixLabel: recommendedMix.map((item) => `${item.customers} ${item.tier}`).join(' + '),
    scenarios,
    motions: [
      'Charge premium monthly plans for trust, packet readiness, and owner/buyer portals.',
      'Use setup and migration fees to fund onboarding and improve cash flow without depending on them for ARR.',
      'Win on category depth: records integrity, ownership clarity, buyer trust, and mobile field speed.',
    ],
  };
}

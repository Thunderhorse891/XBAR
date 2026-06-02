import { buildHorsePacketCompleteness } from './xbarPhaseTwo.js';
import type {
  DocumentRecord,
  HorseRecord,
  IntakeBatch,
  OwnershipRecord,
  RanchAsset,
  SalesLead,
  SharedAccessSnapshot,
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
  intakeBatches: IntakeBatch[];
}) {
  const { horses, documents, ownershipRecords, salesLeads, ranchAssets, intakeBatches } = params;

  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
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
  const slowBatches = intakeBatches.filter((batch) => batch.state !== 'Completed');

  const items: CommandCenterItem[] = [
    {
      id: 'document-review',
      title: reviewQueue.length ? `Review ${reviewQueue.length} documents` : 'Document queue clear',
      summary: 'Assign files and close the queue.',
      module: 'Documents',
      href: '/documents',
      tone: reviewQueue.length > 4 ? 'rose' : 'amber',
      value: reviewQueue.length ? `${reviewQueue.length} waiting` : 'Queue clear',
    },
    {
      id: 'buyer-blockers',
      title: blockedProfiles.length ? `${blockedProfiles.length} sale packets blocked` : 'Sale packets clear',
      summary: 'Private listings still need clean share packets.',
      module: 'Sales',
      href: '/sales',
      tone: blockedProfiles.length ? 'rose' : 'emerald',
      value: blockedProfiles.length ? `${blockedProfiles.length} blocked` : 'All clear',
    },
    {
      id: 'ownership-integrity',
      title: ownershipAttention.length ? `${ownershipAttention.length} transfer blockers` : 'Transfers clean',
      summary: 'Clear signatures, AQHA holds, and owner gaps.',
      module: 'Ownership',
      href: '/ownership',
      tone: ownershipAttention.length > 1 ? 'amber' : 'emerald',
      value: ownershipAttention.length ? `${ownershipAttention.length} open` : 'Clean ledger',
    },
    {
      id: 'buyer-pipeline',
      title: activeOffers.length ? `${activeOffers.length} active inquiries` : 'Inquiry queue calm',
      summary: 'Keep share links and follow-up moving.',
      module: 'Sales',
      href: '/shared-access',
      tone: activeOffers.length ? 'blue' : 'slate',
      value: activeOffers.length ? `${activeOffers.length} hot leads` : 'Pipeline cool',
    },
    {
      id: 'ops-hardware',
      title: serviceRisk.length ? `${serviceRisk.length} tools need service` : 'Field tools ready',
      summary: 'Scanner and field kits need attention.',
      module: 'Ranch Toolkit',
      href: '/assets',
      tone: serviceRisk.length ? 'amber' : 'emerald',
      value: serviceRisk.length ? `${serviceRisk.length} flagged` : 'Tools ready',
    },
    {
      id: 'throughput',
      title: slowBatches.length ? `${slowBatches.length} uploads in progress` : 'Uploads caught up',
      summary: 'Keep uploads moving without spillover.',
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
  sharedAccess: SharedAccessSnapshot;
}) {
  const { horses, documents, ownershipRecords, salesLeads, sharedAccess } = params;
  const buyerReady = buyerReadyProfiles(horses, documents, ownershipRecords).length;
  const unresolvedDocs = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched').length;

  return [
    {
      id: 'scan-intake',
      eyebrow: 'Mobile capture',
      title: 'Add files',
      summary: 'Upload documents to the vault.',
      metric: `${unresolvedDocs} docs still in review`,
      href: '/documents?upload=1',
      tone: unresolvedDocs ? 'amber' : 'emerald',
    },
    {
      id: 'horse-ops',
      eyebrow: 'Field workflow',
      title: 'Update horse records',
      summary: 'Barn, pasture, trailer.',
      metric: `${horses.length} active horse records`,
      href: '/horses',
      tone: 'blue',
    },
    {
      id: 'buyer-share',
      eyebrow: 'Revenue tool',
      title: 'Open share links',
      summary: 'Send clean, sale-ready records.',
      metric: `${buyerReady} sale-ready profiles`,
      href: '/shared-access',
      tone: buyerReady ? 'emerald' : 'amber',
    },
    {
      id: 'lead-response',
      eyebrow: 'Pipeline motion',
      title: 'Work hot leads',
      summary: 'Follow-up, offers, next touch.',
      metric: `${salesLeads.filter((lead) => lead.stage !== 'Closed').length} open conversations`,
      href: '/sales',
      tone: 'blue',
    },
    {
      id: 'owner-experience',
      eyebrow: 'Distribution',
      title: 'Manage shares',
      summary: 'Track live sale links and follow-up.',
      metric: `${sharedAccess.savedHorses} shared records`,
      href: '/shared-access',
      tone: sharedAccess.savedHorses ? 'emerald' : 'slate',
    },
  ] satisfies FieldToolCard[];
}

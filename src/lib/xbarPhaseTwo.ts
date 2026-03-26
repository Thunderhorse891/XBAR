import { rankHorseMatches } from './xbarRuntime.js';
import type { DocumentRecord, HorseRecord, OwnershipRecord, ProcessingState } from '../types/xbar.js';

type Tone = 'blue' | 'slate' | 'emerald' | 'amber' | 'rose';
type PacketStatus = 'ready' | 'review' | 'missing';

export type MatchCandidate = {
  horseId: string;
  horseName: string;
  confidence: number;
  reason: string;
};

export type PacketRequirement = {
  key: string;
  label: string;
  status: PacketStatus;
  detail: string;
  weight: number;
  tone: Tone;
};

export type DocumentTrustProfile = {
  trustScore: number;
  tone: Tone;
  entityCount: number;
  totalEntities: number;
  duplicateSummary: string;
  reviewReasons: string[];
  candidateMatches: MatchCandidate[];
  readyForProfile: boolean;
};

export type BuyerProfileStatus = 'Live' | 'Needs Review' | 'Blocked' | 'Staged';

export type PacketCompleteness = {
  score: number;
  tone: Tone;
  readyCount: number;
  reviewCount: number;
  missingCount: number;
  trustSummary: string;
  buyerSafe: boolean;
  buyerProfileStatus: BuyerProfileStatus;
  buyerProfileTone: Tone;
  buyerProfileNote: string;
  shareSlug: string;
  sharePath: string;
  requirements: PacketRequirement[];
};

function scoreTone(score: number): Tone {
  if (score >= 85) return 'emerald';
  if (score >= 70) return 'blue';
  if (score >= 55) return 'amber';
  return 'rose';
}

function statusTone(status: PacketStatus): Tone {
  if (status === 'ready') return 'emerald';
  if (status === 'review') return 'amber';
  return 'rose';
}

function stateBonus(state: ProcessingState) {
  if (state === 'Ready') return 14;
  if (state === 'Matched') return 10;
  if (state === 'Archived') return 8;
  return 0;
}

function normalizeShareSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function isDocumentReady(document: DocumentRecord) {
  return document.state === 'Ready';
}

function isDocumentResolved(document: DocumentRecord) {
  return document.state === 'Ready' || document.state === 'Matched' || document.state === 'Archived';
}

function collectDocuments(documents: DocumentRecord[], types: DocumentRecord['type'][]) {
  return documents.filter((document) => types.includes(document.type));
}

function describeDuplicateRisk(document: DocumentRecord) {
  if (document.duplicateRisk === 'Possible Duplicate') {
    return 'Possible duplicate against an existing vault record.';
  }
  if (document.duplicateRisk === 'Review') {
    return 'Related document already exists and needs side-by-side review.';
  }
  return 'No duplicate warning on this document.';
}

export function buildDocumentTrustProfile(document: DocumentRecord, horses: HorseRecord[]): DocumentTrustProfile {
  const entityCount = Object.values(document.entities).filter(Boolean).length;
  const candidateMatches = rankHorseMatches(
    horses,
    `${document.title} ${document.extractedTextPreview} ${Object.values(document.entities).filter(Boolean).join(' ')}`,
    document.entities,
  ).map((match) => ({
    horseId: match.horse.id,
    horseName: match.horse.name,
    confidence: Math.round(match.confidence * 100),
    reason: match.reason,
  }));

  const reviewReasons: string[] = [];
  if (document.state === 'Needs Review') reviewReasons.push('Human review still required before packet use');
  if (document.duplicateRisk !== 'Low') reviewReasons.push(describeDuplicateRisk(document));
  if (entityCount < 2) reviewReasons.push('Entity coverage is thin for a buyer-trust surface');
  if (document.confidence < 0.9) reviewReasons.push('Document confidence is still below the preferred buyer threshold');
  if (!document.horseId) reviewReasons.push('The document is not attached to a horse profile yet');

  const duplicatePenalty = document.duplicateRisk === 'Possible Duplicate' ? 18 : document.duplicateRisk === 'Review' ? 8 : 0;
  const trustScore = Math.max(
    24,
    Math.min(
      99,
      Math.round(document.confidence * 68 + (entityCount / 6) * 18 + stateBonus(document.state) - duplicatePenalty),
    ),
  );

  return {
    trustScore,
    tone: scoreTone(trustScore),
    entityCount,
    totalEntities: 6,
    duplicateSummary: describeDuplicateRisk(document),
    reviewReasons,
    candidateMatches,
    readyForProfile: document.state === 'Ready' && document.duplicateRisk === 'Low' && trustScore >= 75,
  };
}

export function buildHorsePacketCompleteness(
  horse: HorseRecord,
  documents: DocumentRecord[],
  ownershipRecord?: OwnershipRecord,
): PacketCompleteness {
  const registrationDocs = collectDocuments(documents, ['Registration', 'Bill of Sale']);
  const ownershipDocs = collectDocuments(documents, ['Ownership Memo', 'Transfer Packet']);
  const medicalDocs = collectDocuments(documents, ['Vet Record', 'Coggins']);
  const mediaDocs = collectDocuments(documents, ['Media Kit']);
  const hasApprovedHero = horse.gallery.some((asset) => asset.kind === 'Hero' && asset.status === 'Approved');
  const hasApprovedSaleStill = horse.gallery.some((asset) => asset.kind === 'Sale Still' && asset.status === 'Approved');
  const hasHighAlert = horse.alerts.some(
    (alert) =>
      alert.severity === 'high' &&
      (alert.module === 'Ownership' || alert.module === 'Medical' || alert.module === 'Documents'),
  );
  const activeListing =
    horse.sale.askPrice > 0 ||
    horse.sale.listingState === 'Buyer Review' ||
    horse.sale.listingState === 'Market Ready' ||
    horse.sale.watchlistCount > 0 ||
    horse.sale.inquiryCount > 0;

  const requirements: PacketRequirement[] = [
    {
      key: 'identity',
      label: 'Identity proof',
      status: registrationDocs.some(isDocumentReady)
        ? 'ready'
        : registrationDocs.some(isDocumentResolved) || horse.registered
          ? 'review'
          : 'missing',
      detail: registrationDocs.some(isDocumentReady)
        ? 'Registry backing document is approved for packet use.'
        : registrationDocs.length
          ? 'Registry data exists, but the source document still needs confirmation.'
          : 'No registration or bill-of-sale source doc is attached yet.',
      weight: 20,
      tone: 'slate',
    },
    {
      key: 'ownership',
      label: 'Ownership integrity',
      status:
        ownershipRecord?.transferStatus === 'Clear' && ownershipDocs.some(isDocumentReady)
          ? 'ready'
          : ownershipDocs.some(isDocumentResolved) || ownershipRecord
            ? 'review'
            : 'missing',
      detail:
        ownershipRecord?.transferStatus === 'Clear' && ownershipDocs.some(isDocumentReady)
          ? 'Ownership packet is clear and backed by approved docs.'
          : ownershipRecord
            ? `Transfer posture is ${ownershipRecord.transferStatus}.`
            : 'No ownership trail is attached to the record yet.',
      weight: 22,
      tone: 'slate',
    },
    {
      key: 'medical',
      label: 'Medical freshness',
      status:
        medicalDocs.some(isDocumentReady) && horse.status !== 'Medical Review'
          ? 'ready'
          : medicalDocs.some(isDocumentResolved) || horse.status === 'Medical Review'
            ? 'review'
            : 'missing',
      detail:
        medicalDocs.some(isDocumentReady) && horse.status !== 'Medical Review'
          ? 'Medical review is current for packet use.'
          : horse.status === 'Medical Review'
            ? 'A medical review is still open on the horse profile.'
            : medicalDocs.length
              ? 'Medical support exists, but it is not fully buyer-ready.'
              : 'No buyer-safe medical support is attached yet.',
      weight: 20,
      tone: 'slate',
    },
    {
      key: 'media',
      label: 'Visual packet',
      status:
        hasApprovedHero && (hasApprovedSaleStill || mediaDocs.some(isDocumentReady))
          ? 'ready'
          : horse.gallery.length || mediaDocs.length
            ? 'review'
            : 'missing',
      detail:
        hasApprovedHero && (hasApprovedSaleStill || mediaDocs.some(isDocumentReady))
          ? 'Hero imagery and packet media are staged for a buyer view.'
          : horse.gallery.length || mediaDocs.length
            ? 'Visual assets exist, but the packet still needs stronger coverage.'
            : 'No buyer-facing media packet is attached yet.',
      weight: 18,
      tone: 'slate',
    },
  ];

  if (activeListing) {
    requirements.push({
      key: 'buyer-packet',
      label: 'Buyer packet trust',
      status:
        mediaDocs.some(isDocumentReady) && horse.sale.socialReady && !hasHighAlert
          ? 'ready'
          : mediaDocs.some(isDocumentResolved) || horse.sale.socialReady
            ? 'review'
            : 'missing',
      detail:
        mediaDocs.some(isDocumentReady) && horse.sale.socialReady && !hasHighAlert
          ? 'Buyer-safe packet is staged for a live share link.'
          : hasHighAlert
            ? 'A high-severity alert is still blocking a buyer-safe release.'
            : 'Buyer packet is present but still needs trust review.',
      weight: 20,
      tone: 'slate',
    });
  }

  const totalWeight = requirements.reduce((sum, requirement) => sum + requirement.weight, 0) || 1;
  const earnedWeight = requirements.reduce((sum, requirement) => {
    if (requirement.status === 'ready') return sum + requirement.weight;
    if (requirement.status === 'review') return sum + requirement.weight * 0.55;
    return sum;
  }, 0);
  const score = Math.round((earnedWeight / totalWeight) * 100);
  const readyCount = requirements.filter((requirement) => requirement.status === 'ready').length;
  const reviewCount = requirements.filter((requirement) => requirement.status === 'review').length;
  const missingCount = requirements.filter((requirement) => requirement.status === 'missing').length;

  let buyerProfileStatus: BuyerProfileStatus = 'Staged';
  if (activeListing) {
    if (score >= 84 && reviewCount === 0 && !hasHighAlert) {
      buyerProfileStatus = 'Live';
    } else if (score >= 60 && readyCount > 0) {
      buyerProfileStatus = 'Needs Review';
    } else {
      buyerProfileStatus = 'Blocked';
    }
  }

  const shareSlug = normalizeShareSlug(horse.name);
  const sharePath = `/profiles/${horse.id}`;
  const trustSummary =
    requirements.length === 0
      ? 'No packet checks are active yet.'
      : `${readyCount} of ${requirements.length} packet checks are clear.`;

  return {
    score,
    tone: scoreTone(score),
    readyCount,
    reviewCount,
    missingCount,
    trustSummary,
    buyerSafe: buyerProfileStatus === 'Live',
    buyerProfileStatus,
    buyerProfileTone:
      buyerProfileStatus === 'Live'
        ? 'emerald'
        : buyerProfileStatus === 'Needs Review'
          ? 'amber'
          : buyerProfileStatus === 'Blocked'
            ? 'rose'
            : 'blue',
    buyerProfileNote:
      buyerProfileStatus === 'Live'
        ? 'This profile is safe to present as a buyer-safe share link.'
        : buyerProfileStatus === 'Needs Review'
          ? 'The buyer-facing profile is useful, but still carries unresolved trust checks.'
          : buyerProfileStatus === 'Blocked'
            ? 'Keep this link internal until the trust blockers clear.'
            : 'Share link is staged, but no live buyer motion is active yet.',
    shareSlug,
    sharePath,
    requirements: requirements.map((requirement) => ({
      ...requirement,
      tone: statusTone(requirement.status),
    })),
  };
}

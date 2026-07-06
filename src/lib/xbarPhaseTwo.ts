import { rankHorseMatches } from './xbarRuntime.js';
import type { DocumentRecord, HorseRecord, OwnershipRecord, ProcessingState } from '../types/xbar.js';

const TRUST_CONFIDENCE_WEIGHT = 68;
const TRUST_ENTITY_WEIGHT = 18;
const TRUST_ENTITY_TOTAL = 6;
const TRUST_SCORE_FLOOR = 24;
const TRUST_SCORE_CAP = 99;
const REVIEW_PARTIAL_CREDIT = 0.55;
const BUYER_LIVE_THRESHOLD = 84;
const BUYER_NEEDS_REVIEW_THRESHOLD = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const CURRENT_COGGINS_DAYS = 365;
const CURRENT_HEALTH_SUPPORT_DAYS = 180;

type Tone = 'blue' | 'slate' | 'emerald' | 'amber' | 'rose';
type PacketStatus = 'ready' | 'review' | 'missing';

type PacketHorseInput = Pick<HorseRecord, 'id' | 'name' | 'status' | 'registered' | 'gallery' | 'sale'> & {
  alerts: Array<Pick<HorseRecord['alerts'][number], 'severity' | 'module'>>;
};

type PacketDocumentInput = Pick<DocumentRecord, 'type' | 'state' | 'entities'>;

type DocumentTrustInput = Pick<
  DocumentRecord,
  'title' | 'extractedTextPreview' | 'entities' | 'state' | 'duplicateRisk' | 'confidence' | 'horseId'
>;

type PacketOwnershipInput = Pick<OwnershipRecord, 'transferStatus'>;

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

export type SalePacketSlot = {
  key: 'aqha-papers' | 'transfer-papers' | 'coggins' | 'health-cert' | 'aqha-photos';
  label: string;
  status: PacketStatus;
  detail: string;
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

export type BuyerProfileStatus = 'Live' | 'Needs Review' | 'Blocked' | 'Private';

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
  saleSlots: SalePacketSlot[];
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

function isDocumentReady(document: PacketDocumentInput) {
  return document.state === 'Ready';
}

function isDocumentResolved(document: PacketDocumentInput) {
  return document.state === 'Ready' || document.state === 'Matched' || document.state === 'Archived';
}

function collectDocuments<TDocument extends PacketDocumentInput>(
  documents: TDocument[],
  types: DocumentRecord['type'][],
) {
  return documents.filter((document) => types.includes(document.type));
}

function getDocumentExamTime(document: PacketDocumentInput) {
  const examDate = document.entities.examDate;
  if (!examDate) {
    return null;
  }

  const parsed = Date.parse(examDate);
  return Number.isNaN(parsed) ? null : parsed;
}

function isCurrentDatedDocument(document: PacketDocumentInput, maxAgeDays: number) {
  const examTime = getDocumentExamTime(document);
  if (examTime === null) {
    return false;
  }

  return Date.now() - examTime <= maxAgeDays * DAY_MS;
}

function hasCurrentReadyDocument(documents: PacketDocumentInput[], maxAgeDays: number) {
  return documents.some((document) => isDocumentReady(document) && isCurrentDatedDocument(document, maxAgeDays));
}

function hasResolvedDocumentMissingCurrentDate(documents: PacketDocumentInput[], maxAgeDays: number) {
  return documents.some((document) => isDocumentResolved(document) && !isCurrentDatedDocument(document, maxAgeDays));
}

function buildSalePacketSlot(params: {
  key: SalePacketSlot['key'];
  label: string;
  ready: boolean;
  review: boolean;
  readyDetail: string;
  reviewDetail: string;
  missingDetail: string;
}): SalePacketSlot {
  const status: PacketStatus = params.ready ? 'ready' : params.review ? 'review' : 'missing';

  return {
    key: params.key,
    label: params.label,
    status,
    detail: status === 'ready' ? params.readyDetail : status === 'review' ? params.reviewDetail : params.missingDetail,
    tone: statusTone(status),
  };
}

function describeDuplicateRisk(document: DocumentTrustInput) {
  if (document.duplicateRisk === 'Possible Duplicate') {
    return 'Possible duplicate against an existing document record.';
  }
  if (document.duplicateRisk === 'Review') {
    return 'Related document already exists and needs side-by-side review.';
  }
  return 'No duplicate warning on this document.';
}

export function buildDocumentTrustProfile(document: DocumentTrustInput, horses: HorseRecord[]): DocumentTrustProfile {
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
  if (entityCount < 2) reviewReasons.push('Entity coverage is thin for a sale packet surface');
  if (document.confidence < 0.9) reviewReasons.push('Document confidence is still below the preferred sale threshold');
  if (!document.horseId) reviewReasons.push('The document is not attached to a horse profile yet');

  const duplicatePenalty =
    document.duplicateRisk === 'Possible Duplicate' ? 18 : document.duplicateRisk === 'Review' ? 8 : 0;
  const trustScore = Math.max(
    TRUST_SCORE_FLOOR,
    Math.min(
      TRUST_SCORE_CAP,
      Math.round(
        document.confidence * TRUST_CONFIDENCE_WEIGHT +
          (entityCount / TRUST_ENTITY_TOTAL) * TRUST_ENTITY_WEIGHT +
          stateBonus(document.state) -
          duplicatePenalty,
      ),
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
  horse: PacketHorseInput,
  documents: PacketDocumentInput[],
  ownershipRecord?: PacketOwnershipInput,
): PacketCompleteness {
  const registrationDocs = collectDocuments(documents, ['Registration', 'Bill of Sale']);
  const ownershipDocs = collectDocuments(documents, ['Ownership Memo', 'Transfer Packet']);
  const medicalDocs = collectDocuments(documents, ['Vet Record', 'Coggins']);
  const mediaDocs = collectDocuments(documents, ['Media Kit']);
  const hasApprovedHero = horse.gallery.some((asset) => asset.kind === 'Hero' && asset.status === 'Approved');
  const hasApprovedSaleStill = horse.gallery.some(
    (asset) => asset.kind === 'Sale Still' && asset.status === 'Approved',
  );
  const hasApprovedConformation = horse.gallery.some(
    (asset) => asset.kind === 'Conformation' && asset.status === 'Approved',
  );
  const approvedSalePhotos = horse.gallery.filter(
    (asset) =>
      asset.status === 'Approved' &&
      (asset.kind === 'Hero' || asset.kind === 'Conformation' || asset.kind === 'Sale Still'),
  );
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

  const cogginsDocs = collectDocuments(documents, ['Coggins']);
  const vetDocs = collectDocuments(documents, ['Vet Record']);
  const hasCurrentCoggins = hasCurrentReadyDocument(cogginsDocs, CURRENT_COGGINS_DAYS);
  const hasCurrentHealthSupport = hasCurrentReadyDocument(vetDocs, CURRENT_HEALTH_SUPPORT_DAYS);
  const medicalDocsCurrent = hasCurrentReadyDocument(medicalDocs, CURRENT_HEALTH_SUPPORT_DAYS);
  const saleSlots: SalePacketSlot[] = [
    buildSalePacketSlot({
      key: 'aqha-papers',
      label: 'AQHA papers',
      ready: registrationDocs.some(isDocumentReady),
      review: registrationDocs.some(isDocumentResolved) || horse.registered,
      readyDetail: 'AQHA registration is approved and attached.',
      reviewDetail: 'Registration data is attached but still needs final confirmation.',
      missingDetail: 'No AQHA registration paper is attached yet.',
    }),
    buildSalePacketSlot({
      key: 'transfer-papers',
      label: 'Transfer papers',
      ready: ownershipRecord?.transferStatus === 'Clear' && ownershipDocs.some(isDocumentReady),
      review: ownershipDocs.some(isDocumentResolved) || Boolean(ownershipRecord),
      readyDetail: 'Transfer packet is clear and attached.',
      reviewDetail:
        ownershipRecord?.transferStatus === 'Clear'
          ? 'Transfer support is attached but still needs final review.'
          : ownershipRecord
            ? `Transfer is ${ownershipRecord.transferStatus.toLowerCase()}.`
            : 'Transfer support is attached but still needs review.',
      missingDetail: 'No transfer packet is attached yet.',
    }),
    buildSalePacketSlot({
      key: 'coggins',
      label: 'Coggins',
      ready: hasCurrentCoggins,
      review: cogginsDocs.some(isDocumentResolved),
      readyDetail: 'Current coggins is approved for travel and sale.',
      reviewDetail: hasResolvedDocumentMissingCurrentDate(cogginsDocs, CURRENT_COGGINS_DAYS)
        ? 'Coggins is attached but needs a current exam date before use.'
        : 'Coggins is attached but still needs final review.',
      missingDetail: 'No coggins is attached yet.',
    }),
    buildSalePacketSlot({
      key: 'health-cert',
      label: 'Health cert',
      ready: hasCurrentHealthSupport && horse.status !== 'Medical Review',
      review: vetDocs.some(isDocumentResolved) || horse.status === 'Medical Review',
      readyDetail: 'Health support is approved and current.',
      reviewDetail:
        horse.status === 'Medical Review'
          ? 'Medical review is still open on the horse profile.'
          : hasResolvedDocumentMissingCurrentDate(vetDocs, CURRENT_HEALTH_SUPPORT_DAYS)
            ? 'Health support is attached but needs a current exam date before use.'
            : 'Health support is attached but still needs final review.',
      missingDetail: 'No health certification is attached yet.',
    }),
    buildSalePacketSlot({
      key: 'aqha-photos',
      label: 'AQHA photos',
      ready: hasApprovedHero && (hasApprovedConformation || hasApprovedSaleStill) && approvedSalePhotos.length >= 2,
      review: approvedSalePhotos.length > 0 || horse.gallery.length > 0 || mediaDocs.some(isDocumentResolved),
      readyDetail: 'Approved hero and conformation photos are ready for the share view.',
      reviewDetail: 'Photos exist, but the sale set still needs stronger approved coverage.',
      missingDetail: 'No approved AQHA photo set is attached yet.',
    }),
  ];

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
        medicalDocsCurrent && horse.status !== 'Medical Review'
          ? 'ready'
          : medicalDocs.some(isDocumentResolved) || horse.status === 'Medical Review'
            ? 'review'
            : 'missing',
      detail:
        medicalDocsCurrent && horse.status !== 'Medical Review'
          ? 'Medical review is current for packet use.'
          : horse.status === 'Medical Review'
            ? 'A medical review is still open on the horse profile.'
            : hasResolvedDocumentMissingCurrentDate(medicalDocs, CURRENT_HEALTH_SUPPORT_DAYS)
              ? 'Medical support exists but needs a current exam date before use.'
              : medicalDocs.length
                ? 'Medical support exists, but it is not fully ready to share.'
                : 'No approved medical support is attached yet.',
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
          ? 'Hero imagery and packet media are approved for sale presentation.'
          : horse.gallery.length || mediaDocs.length
            ? 'Visual assets exist, but the packet still needs stronger coverage.'
            : 'No media packet is attached yet.',
      weight: 18,
      tone: 'slate',
    },
  ];

  if (activeListing) {
    requirements.push({
      key: 'buyer-packet',
      label: 'Record completeness',
      status:
        mediaDocs.some(isDocumentReady) && horse.sale.socialReady && !hasHighAlert
          ? 'ready'
          : mediaDocs.some(isDocumentResolved) || horse.sale.socialReady
            ? 'review'
            : 'missing',
      detail:
        mediaDocs.some(isDocumentReady) && horse.sale.socialReady && !hasHighAlert
          ? 'Sale packet is approved for live sharing.'
          : hasHighAlert
            ? 'A high-severity alert is still blocking release.'
            : 'Sale packet is present but still needs trust review.',
      weight: 20,
      tone: 'slate',
    });
  }

  const totalWeight = requirements.reduce((sum, requirement) => sum + requirement.weight, 0) || 1;
  const earnedWeight = requirements.reduce((sum, requirement) => {
    if (requirement.status === 'ready') return sum + requirement.weight;
    if (requirement.status === 'review') return sum + requirement.weight * REVIEW_PARTIAL_CREDIT;
    return sum;
  }, 0);
  const score = Math.round((earnedWeight / totalWeight) * 100);
  const readyCount = requirements.filter((requirement) => requirement.status === 'ready').length;
  const reviewCount = requirements.filter((requirement) => requirement.status === 'review').length;
  const missingCount = requirements.filter((requirement) => requirement.status === 'missing').length;

  let buyerProfileStatus: BuyerProfileStatus = 'Private';
  if (activeListing) {
    if (score >= BUYER_LIVE_THRESHOLD && reviewCount === 0 && !hasHighAlert) {
      buyerProfileStatus = 'Live';
    } else if (score >= BUYER_NEEDS_REVIEW_THRESHOLD && readyCount > 0) {
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
        ? 'This profile is safe to present as a sale listing link.'
        : buyerProfileStatus === 'Needs Review'
          ? 'The sale profile is useful, but still carries unresolved trust checks.'
          : buyerProfileStatus === 'Blocked'
            ? 'Keep this link internal until the trust blockers clear.'
            : 'Keep this sale packet private until outreach starts.',
    shareSlug,
    sharePath,
    requirements: requirements.map((requirement) => ({
      ...requirement,
      tone: statusTone(requirement.status),
    })),
    saleSlots,
  };
}

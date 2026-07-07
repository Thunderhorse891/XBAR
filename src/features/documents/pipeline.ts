// Relative .js imports keep this module compilable by the NodeNext test build
// (tsconfig.test.json), matching the convention in xbarPhaseTwo/xbarStoreLogic.
import { buildDocumentTrustProfile } from '../../lib/xbarPhaseTwo.js';
import { normalizeOwnershipRecord } from '../../store/xbarStoreLogic.js';
import type { DocumentRecord, HorseRecord, IntakeBatch, OwnershipRecord } from '../../types/xbar.js';

// Documents left in "Needs Review" longer than this are surfaced as stale.
export const STALE_REVIEW_MS = 3 * 24 * 60 * 60 * 1000;

export type PipelineStage = 'Upload' | 'Processing' | 'Review' | 'Proof' | 'Share';

export const PIPELINE_STAGES: { id: PipelineStage; label: string; hint: string }[] = [
  {
    id: 'Upload',
    label: 'Upload',
    hint: 'Bring files in: choose documents, tag a source, and optionally attach a horse.',
  },
  {
    id: 'Processing',
    label: 'OCR / Processing',
    hint: 'OCR runs locally; extracted fields appear here while files are queued.',
  },
  {
    id: 'Review',
    label: 'Review',
    hint: 'Confirm the extracted match, assign the right horse, then approve or discard.',
  },
  { id: 'Proof', label: 'Ownership', hint: 'Use approved documents to support the horse ownership record.' },
  {
    id: 'Share',
    label: 'Share',
    hint: 'Bundle approved documents into watermarked sale packets and hand off to Shared Access.',
  },
];

export type DocumentStageBuckets = {
  queuedDocuments: DocumentRecord[];
  reviewQueue: DocumentRecord[];
  readyDocuments: DocumentRecord[];
  proofDocuments: DocumentRecord[];
  duplicates: DocumentRecord[];
  buyerSafeDocuments: DocumentRecord[];
  processingBatches: IntakeBatch[];
  unmatchedDocuments: DocumentRecord[];
  staleReviewCount: number;
};

/**
 * Partition the workspace's documents into the workflow stages the Documents
 * screen renders. Pure: every bucket is derived from the arguments, and `now`
 * is injectable so the stale-review threshold can be tested deterministically.
 */
export function computeStageBuckets(
  documents: DocumentRecord[],
  horses: HorseRecord[],
  intakeBatches: IntakeBatch[],
  now: number = Date.now(),
): DocumentStageBuckets {
  const queuedDocuments = documents.filter((document) => document.state === 'Queued');
  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
  const readyDocuments = documents.filter((document) => document.state === 'Ready');
  const proofDocuments = readyDocuments.filter((document) => Boolean(document.horseId));
  const duplicates = documents.filter((document) => document.duplicateRisk === 'Possible Duplicate');
  const buyerSafeDocuments = documents.filter(
    (document) => buildDocumentTrustProfile(document, horses).readyForProfile,
  );
  const processingBatches = intakeBatches.filter((batch) => batch.state !== 'Completed');
  const unmatchedDocuments = documents.filter((document) => !document.horseId && document.state !== 'Archived');
  const staleReviewCount = reviewQueue.filter((document) => {
    const uploaded = Date.parse(document.uploadedAt);
    return Number.isFinite(uploaded) && now - uploaded > STALE_REVIEW_MS;
  }).length;

  return {
    queuedDocuments,
    reviewQueue,
    readyDocuments,
    proofDocuments,
    duplicates,
    buyerSafeDocuments,
    processingBatches,
    unmatchedDocuments,
    staleReviewCount,
  };
}

/**
 * Map each document id to the ownership-proof requirement labels it backs.
 */
export function buildProofLinks(ownershipRecords: OwnershipRecord[]): Map<string, string[]> {
  const links = new Map<string, string[]>();
  ownershipRecords.forEach((record) => {
    const normalized = normalizeOwnershipRecord(record);
    (normalized.proofRequirements ?? []).forEach((requirement) => {
      if (requirement.documentId) {
        links.set(requirement.documentId, [...(links.get(requirement.documentId) ?? []), requirement.label]);
      }
    });
  });
  return links;
}

export function computeStageCounts(
  documents: DocumentRecord[],
  buckets: DocumentStageBuckets,
): Record<PipelineStage, number> {
  return {
    Upload: documents.length,
    Processing: buckets.queuedDocuments.length,
    Review: buckets.reviewQueue.length,
    Proof: buckets.proofDocuments.length,
    Share: buckets.readyDocuments.length,
  };
}

export type HeroStatus = { label: string; tone: 'rose' | 'amber' | 'blue' };

export function computeHeroStatus(buckets: DocumentStageBuckets): HeroStatus {
  if (buckets.staleReviewCount > 0 || buckets.unmatchedDocuments.length > 0) {
    return { label: 'Needs attention', tone: 'rose' };
  }
  if (buckets.reviewQueue.length > 0) {
    return { label: 'Review pending', tone: 'amber' };
  }
  return { label: 'All caught up', tone: 'blue' };
}

export type HeroRisk = { label: string; severity: 'rose' | 'amber' };

export function computeHeroRisks(buckets: DocumentStageBuckets): HeroRisk[] {
  const risks: HeroRisk[] = [];
  if (buckets.reviewQueue.length) {
    risks.push({
      label: `${buckets.reviewQueue.length} ${buckets.reviewQueue.length === 1 ? 'document needs' : 'documents need'} review`,
      severity: buckets.staleReviewCount > 0 ? 'rose' : 'amber',
    });
  }
  if (buckets.unmatchedDocuments.length) {
    risks.push({
      label: `${buckets.unmatchedDocuments.length} ${buckets.unmatchedDocuments.length === 1 ? 'document' : 'documents'} not matched to a horse`,
      severity: 'rose',
    });
  }
  return risks;
}

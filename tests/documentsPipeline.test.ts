import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PIPELINE_STAGES,
  STALE_REVIEW_MS,
  buildProofLinks,
  computeHeroRisks,
  computeHeroStatus,
  computeStageBuckets,
  computeStageCounts,
} from '../src/features/documents/pipeline.js';
import type { DocumentRecord, IntakeBatch, OwnershipRecord } from '../src/types/xbar.js';

const NOW = Date.parse('2026-07-01T12:00:00Z');

function makeDocument(patch: Partial<DocumentRecord> & Pick<DocumentRecord, 'id' | 'state'>): DocumentRecord {
  return {
    title: `${patch.id} title`,
    type: 'Registration',
    uploadedBy: 'Tester',
    uploadedAt: new Date(NOW - 60_000).toISOString(),
    source: 'Bulk Intake',
    confidence: 0.9,
    duplicateRisk: 'Low',
    extractedTextPreview: '',
    summary: '',
    entities: {},
    ...patch,
  };
}

function makeBatch(patch: Partial<IntakeBatch> & Pick<IntakeBatch, 'id' | 'state'>): IntakeBatch {
  return {
    label: patch.id,
    receivedAt: new Date(NOW).toISOString(),
    source: 'Bulk Intake',
    fileCount: 1,
    processedCount: 0,
    needsReviewCount: 0,
    matchedCount: 0,
    ...patch,
  };
}

function makeOwnershipRecord(patch: Partial<OwnershipRecord> & Pick<OwnershipRecord, 'id'>): OwnershipRecord {
  return {
    horseId: 'horse-1',
    legalOwner: 'Owner',
    transferStatus: 'Clear',
    pendingDocuments: [],
    complianceDeadline: '',
    confidence: 80,
    auditTrail: [],
    ...patch,
  };
}

test('stage buckets partition documents by workflow state', () => {
  const documents = [
    makeDocument({ id: 'doc-queued', state: 'Queued' }),
    makeDocument({ id: 'doc-review', state: 'Needs Review' }),
    makeDocument({ id: 'doc-matched', state: 'Matched', horseId: 'horse-1' }),
    makeDocument({ id: 'doc-ready', state: 'Ready', horseId: 'horse-1' }),
    makeDocument({ id: 'doc-ready-unattached', state: 'Ready' }),
    makeDocument({ id: 'doc-archived', state: 'Archived' }),
    makeDocument({ id: 'doc-dup', state: 'Needs Review', duplicateRisk: 'Possible Duplicate' }),
  ];
  const batches = [
    makeBatch({ id: 'batch-open', state: 'Reviewing' }),
    makeBatch({ id: 'batch-done', state: 'Completed' }),
  ];

  const buckets = computeStageBuckets(documents, [], batches, NOW);

  assert.deepEqual(
    buckets.queuedDocuments.map((d) => d.id),
    ['doc-queued'],
  );
  assert.deepEqual(
    buckets.reviewQueue.map((d) => d.id),
    ['doc-review', 'doc-matched', 'doc-dup'],
  );
  assert.deepEqual(
    buckets.readyDocuments.map((d) => d.id),
    ['doc-ready', 'doc-ready-unattached'],
  );
  // Proof documents are the Ready docs attached to a horse.
  assert.deepEqual(
    buckets.proofDocuments.map((d) => d.id),
    ['doc-ready'],
  );
  assert.deepEqual(
    buckets.duplicates.map((d) => d.id),
    ['doc-dup'],
  );
  assert.deepEqual(
    buckets.processingBatches.map((b) => b.id),
    ['batch-open'],
  );
  // Archived documents never count as unmatched.
  assert.deepEqual(
    buckets.unmatchedDocuments.map((d) => d.id),
    ['doc-queued', 'doc-review', 'doc-ready-unattached', 'doc-dup'],
  );
});

test('stale review counts only review-queue documents past the threshold', () => {
  const freshAt = new Date(NOW - STALE_REVIEW_MS + 60_000).toISOString();
  const staleAt = new Date(NOW - STALE_REVIEW_MS - 60_000).toISOString();
  const documents = [
    makeDocument({ id: 'doc-fresh', state: 'Needs Review', uploadedAt: freshAt }),
    makeDocument({ id: 'doc-stale', state: 'Needs Review', uploadedAt: staleAt }),
    makeDocument({ id: 'doc-stale-ready', state: 'Ready', uploadedAt: staleAt }),
    makeDocument({ id: 'doc-bad-date', state: 'Needs Review', uploadedAt: 'not-a-date' }),
  ];

  const buckets = computeStageBuckets(documents, [], [], NOW);
  assert.equal(buckets.staleReviewCount, 1);
});

test('stage counts mirror the buckets and cover every pipeline stage', () => {
  const documents = [
    makeDocument({ id: 'doc-queued', state: 'Queued' }),
    makeDocument({ id: 'doc-review', state: 'Needs Review' }),
    makeDocument({ id: 'doc-ready', state: 'Ready', horseId: 'horse-1' }),
  ];
  const buckets = computeStageBuckets(documents, [], [], NOW);
  const counts = computeStageCounts(documents, buckets);

  assert.deepEqual(counts, { Upload: 3, Processing: 1, Review: 1, Proof: 1, Share: 1 });
  // Every advertised stage has a count entry.
  for (const stage of PIPELINE_STAGES) {
    assert.ok(stage.id in counts, `missing count for ${stage.id}`);
  }
});

test('hero status escalates from caught-up to review-pending to needs-attention', () => {
  const caughtUp = computeStageBuckets([makeDocument({ id: 'ok', state: 'Ready', horseId: 'horse-1' })], [], [], NOW);
  assert.deepEqual(computeHeroStatus(caughtUp), { label: 'All caught up', tone: 'blue' });
  assert.deepEqual(computeHeroRisks(caughtUp), []);

  const reviewPending = computeStageBuckets(
    [makeDocument({ id: 'r1', state: 'Needs Review', horseId: 'horse-1' })],
    [],
    [],
    NOW,
  );
  assert.deepEqual(computeHeroStatus(reviewPending), { label: 'Review pending', tone: 'amber' });
  assert.deepEqual(computeHeroRisks(reviewPending), [{ label: '1 document needs review', severity: 'amber' }]);

  const staleAt = new Date(NOW - STALE_REVIEW_MS - 60_000).toISOString();
  const needsAttention = computeStageBuckets(
    [makeDocument({ id: 'r2', state: 'Needs Review', uploadedAt: staleAt })],
    [],
    [],
    NOW,
  );
  assert.deepEqual(computeHeroStatus(needsAttention), { label: 'Needs attention', tone: 'rose' });
  assert.deepEqual(computeHeroRisks(needsAttention), [
    { label: '1 document needs review', severity: 'rose' },
    { label: '1 document not matched to a horse', severity: 'rose' },
  ]);
});

test('proof links map document ids to the requirement labels they back', () => {
  const records = [
    makeOwnershipRecord({
      id: 'own-1',
      proofRequirements: [
        {
          id: 'req-1',
          kind: 'registration_certificate',
          label: 'Registration paper',
          status: 'linked',
          documentId: 'doc-a',
        },
        { id: 'req-2', kind: 'bill_of_sale', label: 'Bill of sale', status: 'missing' },
      ],
    }),
    makeOwnershipRecord({
      id: 'own-2',
      horseId: 'horse-2',
      proofRequirements: [
        { id: 'req-3', kind: 'transfer_form', label: 'Transfer report', status: 'linked', documentId: 'doc-a' },
      ],
    }),
  ];

  const links = buildProofLinks(records);
  assert.deepEqual(links.get('doc-a'), ['Registration paper', 'Transfer report']);
  assert.equal(links.has('doc-missing'), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canMarkTransferClear,
  computeOwnershipConfidence,
  createAuditEvent,
  createOwnershipRecord,
  defaultOwnershipProofRequirements,
  normalizeOwnershipRecord,
} from '../src/store/xbarStoreLogic.js';
import type { HorseRecord, OwnershipProofRequirement, OwnershipRecord } from '../src/types/xbar.js';

const horse = { id: 'horse-test', name: 'Spirit', owner: 'Erin Wyrick' } as HorseRecord;

function requirement(status: OwnershipProofRequirement['status']): OwnershipProofRequirement {
  return { id: `proof-${status}-${Math.random()}`, kind: 'supporting', label: 'Supporting', status };
}

test('default proof requirements cover the legal transfer chain', () => {
  const requirements = defaultOwnershipProofRequirements();
  assert.equal(requirements.length, 4);
  assert.deepEqual(
    requirements.map((item) => item.kind),
    ['bill_of_sale', 'registration_certificate', 'transfer_form', 'signature_page'],
  );
  assert.ok(requirements.every((item) => item.status === 'missing'));
  assert.equal(new Set(requirements.map((item) => item.id)).size, 4);
});

test('confidence is earned from proof, not hardcoded', () => {
  assert.equal(computeOwnershipConfidence([]), 0);
  assert.equal(computeOwnershipConfidence([requirement('missing'), requirement('missing')]), 0);
  assert.equal(computeOwnershipConfidence([requirement('linked'), requirement('missing')]), 25);
  assert.equal(computeOwnershipConfidence([requirement('verified'), requirement('linked')]), 75);
  assert.equal(computeOwnershipConfidence([requirement('verified'), requirement('verified')]), 100);
});

test('transfer cannot be marked Clear with unverified proof', () => {
  const record = createOwnershipRecord(horse);
  const blocked = canMarkTransferClear(record);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockers.length, 4);
  assert.match(blocked.blockers[0] ?? '', /Bill of Sale — missing/);

  const verified: OwnershipRecord = {
    ...record,
    proofRequirements: record.proofRequirements?.map((item) => ({ ...item, status: 'verified' as const })),
  };
  assert.equal(canMarkTransferClear(verified).ok, true);
});

test('legacy records are normalized with a proof chain, idempotently', () => {
  const legacy = {
    id: 'ownership-legacy',
    horseId: horse.id,
    legalOwner: 'Erin Wyrick',
    transferStatus: 'Pending Signatures',
    pendingDocuments: ['Ownership memo'],
    complianceDeadline: '2026-07-01',
    confidence: 35,
    auditTrail: ['2026-06-01 created'],
  } as OwnershipRecord;

  const normalized = normalizeOwnershipRecord(legacy);
  assert.equal(normalized.proofRequirements?.length, 4);
  assert.deepEqual(normalized.auditEvents, []);
  assert.equal(normalized.confidence, 0);

  const again = normalizeOwnershipRecord(normalized);
  assert.deepEqual(again.proofRequirements, normalized.proofRequirements);
  assert.equal(again.confidence, normalized.confidence);
});

test('audit events are structured with actor, action, and entity', () => {
  const event = createAuditEvent({
    actor: 'Admin',
    action: 'status-change',
    entityType: 'ownership',
    entityId: 'ownership-1',
    summary: 'Transfer status changed: Pending Signatures → Clear',
    context: { horseId: 'horse-test' },
  });
  assert.match(event.id, /^audit-/);
  assert.ok(!Number.isNaN(Date.parse(event.at)));
  assert.equal(event.actor, 'Admin');
  assert.equal(event.action, 'status-change');
  assert.equal(event.entityType, 'ownership');
  assert.equal(event.context?.horseId, 'horse-test');
});

test('new ownership records start with an initialized proof chain', () => {
  const record = createOwnershipRecord(horse);
  assert.equal(record.proofRequirements?.length, 4);
  assert.equal(record.confidence, 0);
  assert.equal(record.auditEvents?.length, 1);
  assert.equal(record.auditEvents?.[0]?.action, 'created');
  assert.equal(record.auditEvents?.[0]?.entityId, record.id);
});

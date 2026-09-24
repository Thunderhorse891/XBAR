import assert from 'node:assert/strict';
import test from 'node:test';
import { PROOF_PACKET_THRESHOLD, buildSaleReadinessScore } from '../src/lib/saleReadinessScore.js';
import type {
  DocumentRecord,
  ExpenseReceipt,
  HorseRecord,
  OwnershipProofRequirement,
  OwnershipRecord,
} from '../src/types/xbar.js';

// The sale readiness score is recomputed from what is on file, never stored.
// These tests pin the weights, the "… to reach N" arithmetic, the gaps each
// component reports, and the proof-packet gate — which must hold a packet
// back for the same reasons the packet builder's release gate would.

// Midday local time, so "today" is 2026-06-30 in any zone the suite runs in.
const NOW = new Date(2026, 5, 30, 12);

function makeHorse(overrides: Partial<HorseRecord> = {}): HorseRecord {
  return {
    id: 'h1',
    name: 'Copper Canyon',
    breed: 'Quarter Horse',
    sex: 'Gelding',
    foaledOn: '2019-04-02',
    age: 7,
    color: 'Sorrel',
    markings: 'Star',
    registered: true,
    registrationNumber: '5876123',
    aqhaNumber: '',
    bloodline: { sire: 'Smart Chic Olena', dam: 'Doc Bar Lady' },
    microchipId: '985112004455667',
    owner: 'Thunder Horse Ranch',
    profileImage: 'https://example.test/copper.jpg',
    gallery: [],
    readiness: { score: 0, blockers: [], packetStatus: 'Needs Transfer Docs' },
    ...overrides,
  } as HorseRecord;
}

let seq = 0;
function doc(type: DocumentRecord['type'], fields: Partial<DocumentRecord> = {}): DocumentRecord {
  seq += 1;
  return {
    id: `doc-${seq}`,
    title: type,
    type,
    horseId: 'h1',
    state: 'Ready',
    entities: {},
    ...fields,
  } as DocumentRecord;
}

const receipt = (category: ExpenseReceipt['category'], receiptDate: string, horseId = 'h1') =>
  ({ id: `r-${category}-${receiptDate}`, horseId, category, receiptDate, amount: 50 }) as ExpenseReceipt;

const proofs = (verified: number): OwnershipProofRequirement[] =>
  ['bill_of_sale', 'registration_certificate', 'transfer_form', 'signature_page'].map((kind, index) => ({
    id: `proof-${kind}`,
    kind: kind as OwnershipProofRequirement['kind'],
    label: kind,
    status: index < verified ? 'verified' : 'missing',
  }));

const ownership = (verified: number, transferStatus: OwnershipRecord['transferStatus']): OwnershipRecord => ({
  id: 'own-1',
  horseId: 'h1',
  legalOwner: 'Thunder Horse Ranch',
  transferStatus,
  pendingDocuments: [],
  complianceDeadline: '',
  confidence: 0,
  auditTrail: [],
  proofRequirements: proofs(verified),
});

const currentCoggins = () => doc('Coggins', { entities: { examDate: '2026-03-01' } });
const transferFile = () => doc('Transfer Packet');
const careReceipts = () => [receipt('Wormer', '2026-06-01'), receipt('Dental Float', '2026-02-01')];

const gateClear = { allowed: true, nextAction: 'Release buyer packet.' };

function complete(overrides: Partial<Parameters<typeof buildSaleReadinessScore>[0]> = {}) {
  return buildSaleReadinessScore({
    horse: makeHorse(),
    documents: [currentCoggins(), transferFile()],
    receipts: careReceipts(),
    ownershipRecord: ownership(4, 'Clear'),
    releaseGate: gateClear,
    now: NOW,
    ...overrides,
  });
}

test('a horse with every record on file scores 100 and can generate a proof packet', () => {
  const readiness = complete();

  assert.equal(readiness.score, 100);
  assert.deepEqual(readiness.actions, []);
  assert.equal(readiness.proofPacketReady, true);
  assert.equal(readiness.proofPacketBlocker, null);
  assert.deepEqual(
    readiness.components.map((component) => [component.key, component.max]),
    [
      ['identity', 20],
      ['coggins', 20],
      ['transfer', 15],
      ['media', 15],
      ['care', 15],
      ['ownership', 15],
    ],
    'the weights add to 100',
  );
});

test('each gap names the score it reaches — "Add a current Coggins to reach 85"', () => {
  const readiness = complete({
    horse: makeHorse({ profileImage: '' }),
    documents: [transferFile()],
  });

  assert.equal(readiness.score, 65);
  assert.deepEqual(
    readiness.topActions.map((action) => [action.label, action.reach, action.target]),
    [
      ['Add a current Coggins', 85, 'upload-document'],
      ['Add a photo', 80, 'add-photo'],
    ],
  );
  assert.equal(readiness.proofPacketReady, false);
  assert.equal(readiness.proofPacketBlocker, `Reach ${PROOF_PACKET_THRESHOLD} to generate a proof packet.`);
});

test('a stale Coggins is a renewal and one in review is an approval, not a fresh upload', () => {
  const stale = complete({ documents: [doc('Coggins', { entities: { examDate: '2025-05-01' } }), transferFile()] });
  assert.equal(stale.cogginsCurrent, false);
  assert.equal(stale.actions[0]?.label, 'Add a current Coggins');
  assert.match(stale.components.find((c) => c.key === 'coggins')?.detail ?? '', /past 12 months/);

  const inReview = complete({
    documents: [doc('Coggins', { state: 'Needs Review', entities: { examDate: '2026-03-01' } }), transferFile()],
  });
  assert.equal(inReview.actions[0]?.label, 'Approve the Coggins in review');
  assert.equal(inReview.actions[0]?.target, 'review-documents');
});

test('identity earns partial credit and names what is missing', () => {
  const readiness = complete({
    horse: makeHorse({ bloodline: { sire: '', dam: '' } as HorseRecord['bloodline'], microchipId: '' }),
  });
  const identity = readiness.components.find((component) => component.key === 'identity');

  // Ten identity fields (the photo is scored under media); seven present.
  assert.equal(identity?.earned, 14);
  assert.equal(readiness.score, 94);
  assert.equal(readiness.actions[0]?.label, 'Add sire, dam and 1 more identity detail');
  assert.equal(readiness.actions[0]?.gain, 6);
  assert.equal(readiness.actions[0]?.target, 'edit-horse');
});

test('care counts deworming and dental float from the care board, and says which to log', () => {
  const none = complete({ receipts: [] });
  assert.equal(none.components.find((c) => c.key === 'care')?.earned, 0);
  assert.equal(none.actions[0]?.label, 'Log a deworming and a dental float');
  assert.equal(none.actions[0]?.logCategory, 'Wormer');

  const dentalDue = complete({ receipts: [receipt('Wormer', '2026-06-01')] });
  assert.equal(dentalDue.components.find((c) => c.key === 'care')?.earned, 7.5);
  assert.equal(dentalDue.actions[0]?.label, 'Log a dental float');
  assert.equal(dentalDue.actions[0]?.logCategory, 'Dental Float');
  assert.equal(dentalDue.actions[0]?.target, 'care');

  const otherHorse = complete({ receipts: careReceipts().map((r) => ({ ...r, horseId: 'someone-else' })) });
  assert.equal(otherHorse.components.find((c) => c.key === 'care')?.earned, 0, 'another horse’s wormer does not count');
});

test('the ownership chain earns full credit only when every proof is verified and the transfer is Clear', () => {
  const earned = (record?: OwnershipRecord) =>
    complete({ ownershipRecord: record }).components.find((c) => c.key === 'ownership')?.earned;

  assert.equal(earned(undefined), 0);
  assert.equal(complete({ ownershipRecord: undefined }).actions[0]?.label, 'Start the ownership record');
  assert.equal(earned(ownership(2, 'Pending Signatures')), 7.5);
  assert.equal(
    complete({ ownershipRecord: ownership(2, 'Pending Signatures') }).actions[0]?.label,
    'Verify 2 ownership proofs',
  );
  assert.equal(earned(ownership(4, 'AQHA Review')), 12);
  assert.equal(complete({ ownershipRecord: ownership(4, 'AQHA Review') }).actions[0]?.label, 'Mark the transfer Clear');
  assert.equal(earned(ownership(4, 'Clear')), 15);
});

test('the proof packet follows the release gate the generated packet prints', () => {
  // A perfect score is not enough: the packet prints the gate's verdict for the
  // buyer, so "ready" here must never produce one that says "Release Blocked".
  const blocked = complete({
    releaseGate: { allowed: false, nextAction: 'Health cert: No health certification is attached yet.' },
  });
  assert.equal(blocked.score, 100);
  assert.equal(blocked.proofPacketReady, false);
  assert.equal(blocked.proofPacketBlocker, 'Release gate: Health cert: No health certification is attached yet.');

  // And a clear gate is not enough below the threshold.
  const low = complete({ horse: makeHorse({ profileImage: '' }), documents: [transferFile()] });
  assert.equal(low.proofPacketReady, false);
  assert.match(low.proofPacketBlocker ?? '', /Reach 85/);

  assert.equal(complete().proofPacketReady, true);
});

test('the score is computed from the records, not the stored readiness number', () => {
  const readiness = buildSaleReadinessScore({
    horse: makeHorse({
      profileImage: '',
      readiness: { score: 100, blockers: [], packetStatus: 'Ready' },
    }),
    documents: [],
    receipts: [],
    releaseGate: gateClear,
    now: NOW,
  });

  assert.equal(readiness.score, 20, 'identity only — the stored 100 is ignored');
  assert.equal(readiness.proofPacketReady, false);
});

test('archived documents and other horses’ documents do not count', () => {
  const readiness = complete({
    documents: [
      doc('Coggins', { state: 'Archived', entities: { examDate: '2026-03-01' } }),
      doc('Transfer Packet', { horseId: 'someone-else' }),
    ],
  });

  assert.equal(readiness.cogginsCurrent, false);
  assert.equal(readiness.components.find((c) => c.key === 'transfer')?.earned, 0);
});

test('actions are ordered by what they are worth and the top three are offered', () => {
  const readiness = buildSaleReadinessScore({
    horse: makeHorse({ profileImage: '', microchipId: '' }),
    documents: [],
    receipts: [],
    releaseGate: gateClear,
    now: NOW,
  });

  const gains = readiness.actions.map((action) => action.gain);
  assert.deepEqual(
    gains,
    [...gains].sort((left, right) => right - left),
  );
  assert.equal(readiness.topActions.length, 3);
  assert.ok(readiness.actions.every((action) => action.reach <= 100 && action.reach > readiness.score));
});

test('an annual renewal waiting in review asks for approval, not another upload', () => {
  const readiness = complete({
    documents: [
      doc('Coggins', { entities: { examDate: '2025-05-01' } }), // last year's, reviewed and stale
      doc('Coggins', { state: 'Needs Review', entities: { examDate: '2026-06-02' } }), // this year's, pending
      transferFile(),
    ],
  });

  assert.equal(readiness.cogginsCurrent, false);
  assert.equal(readiness.actions[0]?.label, 'Approve the Coggins in review');
  assert.equal(readiness.actions[0]?.target, 'review-documents');
  assert.match(readiness.components.find((c) => c.key === 'coggins')?.detail ?? '', /waiting in review/);

  // A pending Coggins with no usable date would not help once approved.
  const undated = complete({
    documents: [doc('Coggins', { state: 'Needs Review', entities: {} }), transferFile()],
  });
  assert.equal(undated.actions[0]?.label, 'Add a current Coggins');
});

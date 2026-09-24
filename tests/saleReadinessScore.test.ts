import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  PROOF_PACKET_THRESHOLD,
  buildSaleReadinessScore,
  readinessHeadline,
  readinessNextStep,
} from '../src/lib/saleReadinessScore.js';
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
  assert.equal(
    complete({ ownershipRecord: undefined }).actions[0]?.label,
    'Record ownership, verify its proofs and clear the transfer',
  );
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

test('each ownership action claims only what its own step earns', () => {
  const ownershipAction = (record?: OwnershipRecord) => {
    const readiness = complete({ ownershipRecord: record });
    const action = readiness.actions.find((entry) => entry.key === 'ownership');
    const earned = readiness.components.find((c) => c.key === 'ownership')?.earned ?? 0;
    return { action, earned };
  };

  // Verifying proofs on a transfer that is not Clear stops at the uncleared cap.
  const pending = ownershipAction(ownership(2, 'Pending Signatures'));
  assert.equal(pending.action?.label, 'Verify 2 ownership proofs');
  assert.equal(pending.action?.gain, 4.5, '7.5 → the 12 cap, not → 15');
  assert.equal(
    ownershipAction(ownership(4, 'Pending Signatures')).earned,
    pending.earned + (pending.action?.gain ?? 0),
    'doing exactly what the action says lands on the score it promised',
  );

  // On a Clear transfer, verifying the rest earns everything left.
  assert.equal(ownershipAction(ownership(2, 'Clear')).action?.gain, 7.5);
  assert.equal(ownershipAction(ownership(4, 'AQHA Review')).action?.gain, 3);

  // With no record, the action names the whole path to the full 15.
  const missing = ownershipAction(undefined).action;
  assert.equal(missing?.gain, 15);
  assert.match(missing?.label ?? '', /verify its proofs and clear the transfer/);

  // When verifying alone would earn nothing more, the action includes clearing.
  const five = ownership(4, 'Pending Signatures');
  five.proofRequirements = [
    ...five.proofRequirements!,
    { id: 'proof-extra', kind: 'supporting', label: 'Brand inspection', status: 'missing' },
  ] as OwnershipProofRequirement[];
  const capped = ownershipAction(five);
  assert.equal(capped.earned, 12);
  assert.equal(capped.action?.label, 'Verify 1 ownership proof and mark the transfer Clear');
  assert.equal(capped.action?.gain, 3);
});

test('every roster readiness figure is the computed score, and a private listing says what to set', async () => {
  // Horses.tsx and the release gate sit behind the Vite alias, so their call
  // sites are pinned from source.
  const horses = await readFile('src/routes/Horses.tsx', 'utf8');
  assert.doesNotMatch(horses, /packet\.score/, 'no roster view reads the older packet-completeness score');
  assert.ok((horses.match(/saleReadinessById\.get\(horse\.id\)/g) ?? []).length >= 3, 'table, cards and quick review');

  const gate = await readFile('src/lib/buyerPacketReleaseGate.ts', 'utf8');
  assert.match(gate, /buyerProfileStatus === 'Private'\) \{\s*blockers\.push\(PRIVATE_LISTING_BLOCKER\)/);
  assert.match(gate, /PRIVATE_LISTING_BLOCKER =\s*'Listing: [^']*asking price[^']*'/);
});

test('the profile suggests the next step from the computed score, never the stored blockers', async () => {
  const fresh = complete({ documents: [], receipts: [], ownershipRecord: undefined });
  const top = fresh.topActions[0]!;
  assert.equal(readinessNextStep(fresh, 'COPPER CANYON'), `${top.label} to reach ${top.reach}`);

  const blocked = complete({ releaseGate: { allowed: false, nextAction: 'Health cert: Attach one.' } });
  assert.equal(readinessNextStep(blocked, 'COPPER CANYON'), 'Release gate: Health cert: Attach one.');

  const ready = complete();
  assert.equal(readinessNextStep(ready, 'COPPER CANYON'), "Generate COPPER CANYON's proof packet");

  // The stored blockers are seeded at creation and never cleared, so a
  // complete horse would still read "Registration not verified".
  const profile = await readFile('src/routes/AnimalProfile.tsx', 'utf8');
  assert.match(profile, /readinessNextStep\(saleReadiness, animal\.name\)/);
  assert.doesNotMatch(profile, /animal\.readiness\?\.blockers/);
});

test('"every record is in place" is said only when every record is', async () => {
  // At 85 the packet can go out, but Care records at 0 of 15 is not "every record".
  const noCare = complete({ receipts: [] });
  assert.equal(noCare.score, 85);
  assert.equal(noCare.proofPacketReady, true);
  const headline = readinessHeadline(noCare);
  assert.doesNotMatch(headline.title, /Every record/);
  assert.equal(headline.label, 'Ready for a proof packet');
  assert.match(headline.title, /Log a deworming and a dental float to reach 100/);

  assert.deepEqual(readinessHeadline(complete()), {
    label: 'Ready for buyers',
    title: 'Every record a buyer checks is in place.',
  });

  const card = await readFile('src/components/SaleReadinessCard.tsx', 'utf8');
  assert.match(card, /const headline = readinessHeadline\(readiness\);/);
  assert.doesNotMatch(card, /Every record a buyer checks/);
});

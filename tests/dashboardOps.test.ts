import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHorseDocumentActions, horseAgeLabel } from '../src/lib/horseDocumentActions.js';
import { buildHorsePacketCompleteness } from '../src/lib/xbarPhaseTwo.js';
import { buildBudgetSummary, buildCareBoardRows, buildTransferGapRows } from '../src/lib/dashboardOps.js';
import type { DocumentRecord, ExpenseReceipt, HorseRecord, OwnershipRecord } from '../src/types/xbar.js';

const horses: HorseRecord[] = [
  {
    id: 'horse-1',
    name: 'WIGGY N RED',
    barnName: 'Wiggy',
    summary: 'Fixture horse',
    segment: 'Sale Prospect',
    status: 'Sale Prep',
    breed: 'Quarter Horse',
    registry: 'AQHA',
    aqhaNumber: 'AQHA 6128841',
    registrationNumber: 'WGY-RED-2018',
    registered: true,
    age: 8,
    foaledOn: '2018-03-11',
    sex: 'Mare',
    color: 'Sorrel',
    markings: 'Star',
    microchipId: '9810',
    owner: 'Erin Wyrick',
    ownerEntity: 'XBAR LLC',
    insuredValue: 150000,
    profileImage: '/horse.png',
    tags: [],
    bloodline: { sire: 'Sire', dam: 'Dam', family: 'Family' },
    location: { ranch: 'North Yard', barn: 'Barn A', pasture: 'Pasture 4', stall: 'A-07' },
    assignments: { trainer: 'Trainer', ranchManager: 'Manager', veterinarian: 'Dr. Vet', farrier: 'Farrier' },
    ownership: [],
    gallery: [],
    sale: {
      listingState: 'Market Ready',
      askPrice: 148000,
      buyerConfidence: 90,
      inquiryCount: 3,
      watchlistCount: 2,
      socialReady: true,
    },
    readiness: {
      score: 90,
      blockers: [],
      packetStatus: 'Ready',
    },
    medicalNotes: 'Clear',
    lastVetVisit: '2026-03-20',
    documents: ['doc-1'],
    medicalTimeline: [],
    breedingTimeline: [],
    activity: [],
    documentFacts: [],
    alerts: [],
    notes: [],
  },
];

const documents: DocumentRecord[] = [
  {
    id: 'doc-1',
    title: 'Coggins',
    type: 'Coggins',
    horseId: 'horse-1',
    uploadedBy: 'Ops',
    uploadedAt: '2025-03-15',
    source: 'Bulk Intake',
    state: 'Ready',
    confidence: 0.98,
    duplicateRisk: 'Low',
    extractedTextPreview: 'Exam',
    summary: 'Ready',
    entities: { horseName: 'WIGGY N RED', examDate: '2025-03-15' },
  },
];

const ownershipRecords: OwnershipRecord[] = [
  {
    id: 'ownership-1',
    horseId: 'horse-1',
    legalOwner: 'Erin Wyrick',
    transferStatus: 'Pending Signatures',
    pendingDocuments: ['Buyer signature page'],
    complianceDeadline: '2026-03-30',
    confidence: 72,
    auditTrail: [],
  },
];

const receipts: ExpenseReceipt[] = [
  {
    id: 'receipt-1',
    horseId: 'horse-1',
    title: 'Feed pallet',
    category: 'Feed',
    vendor: 'Feed Co',
    amount: 1200,
    receiptDate: '2026-03-15',
    uploadedAt: '2026-03-15T10:00:00.000Z',
    uploadedBy: 'Ops',
  },
  {
    id: 'receipt-2',
    horseId: 'horse-1',
    title: 'Wormer pack',
    category: 'Wormer',
    vendor: 'Vet Co',
    amount: 90,
    receiptDate: '2025-10-01',
    uploadedAt: '2025-10-01T10:00:00.000Z',
    uploadedBy: 'Ops',
  },
];

test('buildTransferGapRows surfaces missing transfer support', () => {
  const rows = buildTransferGapRows(horses, ownershipRecords, documents);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.horseName, 'WIGGY N RED');
  assert.ok(rows[0]?.reasons.includes('Transfer packet missing'));
  assert.ok(rows[0]?.reasons.includes('Buyer signature page'));
});

test('buildCareBoardRows flags overdue care tasks', () => {
  const rows = buildCareBoardRows(horses, documents, receipts, new Date('2026-03-29T12:00:00.000Z'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.signals.find((signal) => signal.key === 'wormer')?.status, 'due');
  assert.equal(rows[0]?.signals.find((signal) => signal.key === 'dental')?.status, 'due');
  assert.equal(rows[0]?.signals.find((signal) => signal.key === 'coggins')?.status, 'due');
});

test('buildBudgetSummary rolls up current month spend by category', () => {
  const summary = buildBudgetSummary(receipts, new Date('2026-03-29T12:00:00.000Z'));

  assert.equal(summary.total, 1200);
  assert.equal(summary.feed, 1200);
  assert.equal(summary.health, 0);
  assert.equal(summary.receiptCount, 1);
  assert.equal(summary.categories[0]?.category, 'Feed');
});

test('horse document actions are the canonical non-photo sale gaps, not new requirements', () => {
  const horse = horses[0];
  const record = ownershipRecords[0];
  const slots = buildHorsePacketCompleteness(
    horse,
    documents.filter((doc) => doc.horseId === horse.id),
    record,
  ).saleSlots;
  const actions = buildHorseDocumentActions(horse, documents, record);
  assert.deepEqual(
    actions.map(({ key, status, detail }) => ({ key, status, detail })),
    slots
      .filter((slot) => slot.key !== 'aqha-photos' && slot.status !== 'ready')
      .map(({ key, status, detail }) => ({ key, status, detail })),
  );
  assert.ok(actions.every((action) => action.horseId === horse.id && action.horseName === horse.name));
});

test('missing registration opens that horse upload, while existing unreviewed papers open its library', () => {
  const horse = { ...horses[0], id: 'horse /?&=1', registered: false, registry: 'APHA' };
  const missing = buildHorseDocumentActions(horse, []).find((action) => action.key === 'aqha-papers')!;
  assert.equal(missing.status, 'missing');
  assert.equal(missing.action, 'Upload APHA papers');
  const upload = new URL(missing.path, 'https://fixture.test');
  assert.equal(upload.pathname, '/documents');
  assert.equal(upload.searchParams.get('horse'), horse.id);
  assert.equal(upload.searchParams.get('requirement'), 'aqha-papers');
  assert.equal(upload.searchParams.get('upload'), '1');
  assert.equal(upload.searchParams.get('from'), 'profile');
  const reviewDoc: DocumentRecord = { ...documents[0], type: 'Registration', state: 'Matched', horseId: horse.id };
  const review = buildHorseDocumentActions(horse, [reviewDoc]).find((action) => action.key === 'aqha-papers')!;
  assert.equal(review.status, 'review');
  assert.equal(review.action, 'Review APHA papers');
  const library = new URL(review.path, 'https://fixture.test');
  assert.equal(library.searchParams.get('stage'), 'Library');
  assert.equal(library.searchParams.get('upload'), null);
  assert.equal(library.searchParams.get('horse'), horse.id);
});

test('another horse or archived registration cannot clear the requested horse gap', () => {
  const horse = { ...horses[0], registered: false };
  const registration: DocumentRecord = { ...documents[0], type: 'Registration', state: 'Ready', horseId: horse.id };
  assert.ok(!buildHorseDocumentActions(horse, [registration]).some((action) => action.key === 'aqha-papers'));
  for (const doc of [
    { ...registration, horseId: 'another-horse' },
    { ...registration, state: 'Archived' as const },
  ]) {
    assert.equal(
      buildHorseDocumentActions(horse, [doc]).find((action) => action.key === 'aqha-papers')?.status,
      doc.state === 'Archived' ? 'review' : 'missing',
    );
  }
});

test('roster age copy does not present the empty-record zero as a known age', () => {
  assert.equal(horseAgeLabel({ age: 0 }), 'Age not recorded');
  assert.equal(horseAgeLabel({ age: Number.NaN }), 'Age not recorded');
  assert.equal(horseAgeLabel({ age: 1 }), '1 year old');
  assert.equal(horseAgeLabel({ age: 8 }), '8 years old');
});

test('metadata-only and archived-only gaps offer upload, without changing canonical review status', () => {
  const horse = { ...horses[0], registered: true, status: 'Medical Review' as const };
  const metadataActions = buildHorseDocumentActions(horse, [], ownershipRecords[0]);
  for (const key of ['aqha-papers', 'transfer-papers', 'health-cert']) {
    const action = metadataActions.find((item) => item.key === key)!;
    assert.equal(action.status, 'review');
    assert.equal(action.intent, 'upload');
    assert.equal(new URL(action.path, 'https://fixture.test').searchParams.get('upload'), '1');
  }
  const archived: DocumentRecord = { ...documents[0], type: 'Registration', state: 'Archived' };
  const action = buildHorseDocumentActions(horse, [archived]).find((item) => item.key === 'aqha-papers')!;
  assert.equal(action.intent, 'upload');
});

test('existing unresolved originals lead to review or processing rather than a duplicate upload', () => {
  const horse = { ...horses[0], registered: false };
  for (const state of ['Needs Review', 'Queued'] as const) {
    const document: DocumentRecord = { ...documents[0], type: 'Registration', state };
    const action = buildHorseDocumentActions(horse, [document]).find((item) => item.key === 'aqha-papers')!;
    assert.equal(action.status, 'missing');
    assert.equal(action.intent, state === 'Queued' ? 'processing' : 'review');
    const path = new URL(action.path, 'https://fixture.test');
    assert.equal(path.searchParams.get('upload'), null);
    assert.equal(path.searchParams.get('stage'), state === 'Queued' ? 'Processing' : 'Library');
  }
});

test('dated evidence that needs renewal can be viewed or replaced without claiming an approval action', () => {
  const oldCoggins = { ...documents[0], entities: { examDate: '2000-01-01' } };
  const action = buildHorseDocumentActions(horses[0], [oldCoggins]).find((item) => item.key === 'coggins')!;
  assert.equal(action.intent, 'view');
  assert.equal(action.action, 'View Coggins');
  assert.equal(new URL(action.uploadPath, 'https://fixture.test').searchParams.get('upload'), '1');
  assert.equal(new URL(action.uploadPath, 'https://fixture.test').searchParams.get('horse'), horses[0].id);
});

test('record header uses the same unknown-age presentation as the roster', () => {
  const profile = readFileSync('src/routes/AnimalProfile.tsx', 'utf8');
  const header = profile.slice(
    profile.indexOf('className="xs-objhead__meta"'),
    profile.indexOf('className="xs-passport-id"'),
  );
  assert.match(header, /horseAgeLabel\(animal\)/);
  assert.doesNotMatch(header, /\{animal\.age\} yrs/);
});

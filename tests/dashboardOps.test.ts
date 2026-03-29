import assert from 'node:assert/strict';
import test from 'node:test';
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

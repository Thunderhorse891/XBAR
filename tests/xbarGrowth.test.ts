import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommandCenter, buildFieldTools, buildRevenueBlueprint } from '../src/lib/xbarGrowth.js';
import type {
  DocumentRecord,
  HorseRecord,
  OCRBatch,
  OwnershipRecord,
  PortalSnapshot,
  RanchAsset,
  SalesLead,
  SubscriptionProfile,
} from '../src/types/xbar.js';

const horse: HorseRecord = {
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
  gallery: [
    { id: 'hero-1', label: 'Hero', kind: 'Hero', url: '/hero.png', status: 'Approved' },
    { id: 'sale-1', label: 'Sale', kind: 'Sale Still', url: '/sale.png', status: 'Approved' },
  ],
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
  documents: ['doc-1', 'doc-2', 'doc-3'],
  medicalTimeline: [],
  breedingTimeline: [],
  activity: [],
  ocrFacts: [],
  alerts: [],
  notes: [],
};

const documents: DocumentRecord[] = [
  {
    id: 'doc-1',
    title: 'Registration',
    type: 'Registration',
    horseId: 'horse-1',
    uploadedBy: 'Ops',
    uploadedAt: '2026-03-20',
    source: 'Bulk Intake',
    state: 'Ready',
    confidence: 0.98,
    duplicateRisk: 'Low',
    extractedTextPreview: 'WGY-RED-2018',
    summary: 'Ready',
    entities: { horseName: 'WIGGY N RED', registrationNumber: 'WGY-RED-2018', ownerName: 'Erin Wyrick' },
  },
  {
    id: 'doc-2',
    title: 'Vet note',
    type: 'Vet Record',
    horseId: 'horse-1',
    uploadedBy: 'Ops',
    uploadedAt: '2026-03-20',
    source: 'Bulk Intake',
    state: 'Ready',
    confidence: 0.96,
    duplicateRisk: 'Low',
    extractedTextPreview: 'Dr. Vet 2026-03-20',
    summary: 'Ready',
    entities: { horseName: 'WIGGY N RED', examDate: '2026-03-20', veterinarian: 'Dr. Vet' },
  },
  {
    id: 'doc-3',
    title: 'Sale packet',
    type: 'Media Kit',
    horseId: 'horse-1',
    uploadedBy: 'Ops',
    uploadedAt: '2026-03-20',
    source: 'Sales Packet',
    state: 'Ready',
    confidence: 0.95,
    duplicateRisk: 'Low',
    extractedTextPreview: 'Packet',
    summary: 'Ready',
    entities: { horseName: 'WIGGY N RED' },
  },
  {
    id: 'doc-4',
    title: 'Unresolved transfer',
    type: 'Transfer Packet',
    horseId: 'horse-1',
    uploadedBy: 'Ops',
    uploadedAt: '2026-03-20',
    source: 'Owner Portal',
    state: 'Needs Review',
    confidence: 0.71,
    duplicateRisk: 'Possible Duplicate',
    extractedTextPreview: 'Signature missing',
    summary: 'Needs review',
    entities: { horseName: 'WIGGY N RED', transferStatus: 'Pending Signatures' },
  },
];

const ownershipRecords: OwnershipRecord[] = [
  {
    id: 'ownership-1',
    horseId: 'horse-1',
    legalOwner: 'Erin Wyrick',
    transferStatus: 'Clear',
    pendingDocuments: [],
    complianceDeadline: '2026-04-01',
    confidence: 98,
    auditTrail: [],
  },
];

const salesLeads: SalesLead[] = [
  {
    id: 'lead-1',
    name: 'Buyer',
    channel: 'Referral',
    horseId: 'horse-1',
    stage: 'Offer',
    lastTouch: '2026-03-25',
    savedListing: true,
    ownerPortalReady: true,
  },
];

const ranchAssets: RanchAsset[] = [
  {
    id: 'asset-1',
    name: 'Scanner',
    category: 'Equipment',
    status: 'In Service',
    condition: 'Attention Required',
    assignedTo: 'Ops',
    location: 'Records Room',
    nextService: '2026-03-30',
    notes: 'Needs maintenance',
  },
];

const ocrBatches: OCRBatch[] = [
  {
    id: 'batch-1',
    label: 'AQHA intake',
    receivedAt: '2026-03-25 08:00',
    source: 'Ops desk',
    fileCount: 5,
    processedCount: 3,
    needsReviewCount: 2,
    matchedCount: 3,
    state: 'Reviewing',
  },
];

const portal: PortalSnapshot = {
  invitedOwners: 10,
  activeOwners: 4,
  savedHorses: 5,
  openInquiries: 2,
};

const subscription: SubscriptionProfile = {
  tier: 'Professional',
  monthlyRate: 1290,
  renewalDate: '2026-04-12',
  billingState: 'Active',
  ownerPortalEnabled: true,
  brandedListings: true,
  featureFlags: ['Manual document review'],
  usage: {
    seatsUsed: 5,
    seatLimit: 8,
    ocrProcessed: 200,
    ocrLimit: 1800,
    storageUsedGb: 12,
    storageLimitGb: 200,
    portalSeatsUsed: 4,
    portalSeatLimit: 10,
  },
};

test('buildRevenueBlueprint returns a credible ARR model', () => {
  const blueprint = buildRevenueBlueprint(subscription);
  assert.equal(blueprint.currentArr, 15480);
  assert.ok(blueprint.customersNeededAtCurrentTier > 600);
  assert.ok(blueprint.recommendedMixArr >= 10_000_000);
});

test('buildCommandCenter prioritizes trust and revenue actions', () => {
  const items = buildCommandCenter({
    horses: [horse],
    documents,
    ownershipRecords,
    salesLeads,
    ranchAssets,
    ocrBatches,
  });

  assert.ok(items.length > 0);
  assert.equal(items[0]?.module, 'Documents');
});

test('buildFieldTools highlights mobile capture and buyer sharing workflows', () => {
  const cards = buildFieldTools({
    horses: [horse],
    documents,
    ownershipRecords,
    salesLeads,
    portal,
  });

  assert.equal(cards.length, 5);
  assert.ok(cards.some((card) => card.href === '/documents?upload=1'));
  assert.ok(cards.some((card) => card.href === '/portal'));
});

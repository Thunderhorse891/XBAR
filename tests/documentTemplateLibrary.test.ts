import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrefilledDocument, documentTemplateLibrary } from '../src/lib/documentTemplateLibrary.js';
import type { DocumentRecord, HorseRecord, WorkspaceProfile } from '../src/types/xbar.js';

const workspaceProfile: WorkspaceProfile = {
  ranchName: 'XBAR Ranch',
  businessName: 'XBAR LLC',
  defaultOwnerName: 'Erin Wyrick',
  defaultOwnerEntity: 'XBAR LLC',
  ranchManagerName: 'Ranch Manager',
  operationsEmail: 'ops@example.com',
  defaultBarn: 'Main Barn',
  defaultPasture: 'North Pasture',
  workspaceShortcuts: [],
  setupCompleteAt: '2026-06-09',
};

const horse: HorseRecord = {
  id: 'horse-blue',
  name: 'Blue',
  barnName: 'Blue',
  summary: 'Finished ranch horse',
  segment: 'Sale Prospect',
  status: 'Sale Prep',
  breed: 'Quarter Horse',
  registry: 'AQHA',
  aqhaNumber: 'AQHA-123',
  registrationNumber: 'REG-123',
  registered: true,
  age: 7,
  foaledOn: '2019-04-01',
  sex: 'Gelding',
  color: 'Bay',
  markings: 'Star',
  microchipId: '985141001234567',
  owner: 'Erin Wyrick',
  ownerEntity: 'XBAR LLC',
  insuredValue: 25000,
  profileImage: '',
  tags: ['safe'],
  bloodline: { sire: 'Sire', dam: 'Dam', family: 'Foundation' },
  location: { ranch: 'XBAR Ranch', barn: 'Main Barn', pasture: 'North', stall: '12' },
  assignments: { trainer: 'Trainer', ranchManager: 'Manager', veterinarian: 'Dr. Smith', farrier: 'Farrier' },
  ownership: [],
  gallery: [],
  sale: { listingState: 'Market Ready', askPrice: 35000, buyerConfidence: 90, inquiryCount: 2, watchlistCount: 4, socialReady: true },
  readiness: { score: 88, blockers: [], packetStatus: 'Ready' },
  medicalNotes: 'No current limitations.',
  lastVetVisit: '2026-05-01',
  documents: ['doc-coggins'],
  medicalTimeline: [],
  breedingTimeline: [],
  activity: [],
  documentFacts: [],
  alerts: [],
  notes: [],
};

const coggins: DocumentRecord = {
  id: 'doc-coggins',
  title: 'Blue Coggins 2026',
  type: 'Coggins',
  horseId: 'horse-blue',
  uploadedBy: 'Ranch Manager',
  uploadedAt: '2026-05-02',
  source: 'Manual Upload',
  state: 'Ready',
  confidence: 0.95,
  duplicateRisk: 'Low',
  extractedTextPreview: 'Blue coggins negative',
  summary: 'Coggins matched to Blue.',
  entities: { horseName: 'Blue', examDate: '2026-05-01', veterinarian: 'Dr. Smith' },
};

test('document template library contains requested tiered templates', () => {
  assert.equal(documentTemplateLibrary.length, 15);
  assert.ok(documentTemplateLibrary.some((template) => template.id === 'bill-of-sale' && template.tier === 'Basic'));
  assert.ok(documentTemplateLibrary.some((template) => template.id === 'sales-packet' && template.tier === 'Pro'));
  assert.ok(documentTemplateLibrary.some((template) => template.id === 'release-liability-waiver' && template.tier === 'Business'));
});

test('prefilled sales packet uses horse and document data', () => {
  const generated = buildPrefilledDocument({
    templateId: 'sales-packet',
    horse,
    workspaceProfile,
    documents: [coggins],
    sharedLink: 'https://xbar.test/profiles/horse-blue',
    now: new Date('2026-06-09T12:00:00Z'),
  });

  assert.match(generated.html, /Blue/);
  assert.match(generated.html, /REG-123/);
  assert.match(generated.html, /985141001234567/);
  assert.match(generated.html, /Blue Coggins 2026/);
  assert.equal(generated.missingFields.length, 0);
});

test('prefill flags missing signature-critical fields', () => {
  const incompleteHorse = { ...horse, registrationNumber: '', aqhaNumber: '', microchipId: '' };
  const generated = buildPrefilledDocument({
    templateId: 'bill-of-sale',
    horse: incompleteHorse,
    workspaceProfile,
    documents: [],
    now: new Date('2026-06-09T12:00:00Z'),
  });

  assert.ok(generated.missingFields.includes('registration number'));
  assert.ok(generated.missingFields.includes('microchip'));
  assert.match(generated.html, /Missing before signature/);
});

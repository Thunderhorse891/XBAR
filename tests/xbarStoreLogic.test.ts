import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentRecord } from '../src/lib/xbarRuntime.js';
import {
  summarizeBatch,
  validateAssetPatch,
  validateHorseNoteInput,
  validateLeadInput,
  validateLocationPatch,
  validateNewHorseInput,
} from '../src/store/xbarStoreLogic.js';
import type { DocumentRecord, IntakeBatch } from '../src/types/xbar.js';

test('registration paper intake extracts a new horse identity without an existing profile', async () => {
  const file = new File(
    [
      [
        'Certificate of Registration',
        'Registered Name: Smart Lena Bar',
        'Registration Number: AQHA1234567',
        'Owner: Blue River Ranch LLC',
        'Sex: Mare',
      ].join('\n'),
    ],
    'registration-paper.txt',
    { type: 'text/plain' },
  );

  const document = await buildDocumentRecord({
    file,
    uploadedBy: 'Ops Desk',
    source: 'Bulk Intake',
    horses: [],
    existingDocuments: [],
  });

  assert.equal(document.type, 'Registration');
  assert.equal(document.entities.horseName, 'Smart Lena Bar');
  // The registration number is stored registry-free; the registry is its own field.
  assert.equal(document.entities.registrationNumber, '1234567');
  assert.equal(document.entities.registry, 'AQHA');
  assert.equal(document.entities.sex, 'Mare');
  assert.equal(document.entities.ownerName, 'Blue River Ranch LLC');
});

test('validateNewHorseInput rejects incomplete horse records', () => {
  assert.equal(
    validateNewHorseInput({
      name: 'AB',
      barnName: 'Rio',
      segment: 'Sale Prospect',
      status: 'Sale Prep',
      sex: 'Mare',
      owner: 'Erin Wyrick',
      ownerEntity: 'XBAR LLC',
      barn: 'Barn A',
      pasture: 'Pasture 4',
    }),
    'Registered name is required.',
  );
});

test('validateLocationPatch requires at least one changed field', () => {
  assert.equal(validateLocationPatch({}), 'Enter at least one location field before saving.');
  assert.equal(validateLocationPatch({ barn: 'North Barn' }), null);
});

test('validateLeadInput and validateHorseNoteInput guard empty values', () => {
  assert.equal(validateLeadInput({ name: ' ', channel: 'Facebook', horseId: 'horse-1' }), 'Lead name is required.');
  assert.equal(
    validateHorseNoteInput({ title: '  ', body: 'Needs turnout', author: 'Field Ops', tone: 'info' }),
    'Note title is required.',
  );
});

test('validateAssetPatch requires assignment and service dates for active assets', () => {
  assert.equal(
    validateAssetPatch({
      status: 'Assigned',
      condition: 'Excellent',
      assignedTo: '',
      location: 'Barn A',
      nextService: '',
    }),
    'Assigned to is required when an asset is assigned or in service.',
  );

  assert.equal(
    validateAssetPatch({
      status: 'In Service',
      condition: 'Service Soon',
      assignedTo: 'Medical Team',
      location: 'Clinic',
      nextService: '',
    }),
    'Next service date is required for maintenance-sensitive assets.',
  );
});

test('summarizeBatch recalculates processing counts from documents', () => {
  const batch: IntakeBatch = {
    id: 'batch-1',
    label: 'Batch 1',
    receivedAt: '2026-03-25 10:30',
    source: 'Bulk Intake',
    fileCount: 0,
    processedCount: 0,
    needsReviewCount: 0,
    matchedCount: 0,
    state: 'Queued',
  };

  const documents: DocumentRecord[] = [
    {
      id: 'doc-1',
      batchId: 'batch-1',
      title: 'Transfer Packet',
      type: 'Transfer Packet',
      horseId: 'horse-1',
      uploadedBy: 'Ops Desk',
      uploadedAt: '2026-03-25',
      source: 'Bulk Intake',
      state: 'Ready',
      confidence: 0.98,
      duplicateRisk: 'Low',
      extractedTextPreview: 'Ready',
      summary: 'Ready',
      entities: { horseName: 'Horse One' },
    },
    {
      id: 'doc-2',
      batchId: 'batch-1',
      title: 'Vet Record',
      type: 'Vet Record',
      horseId: 'horse-1',
      uploadedBy: 'Ops Desk',
      uploadedAt: '2026-03-25',
      source: 'Bulk Intake',
      state: 'Needs Review',
      confidence: 0.64,
      duplicateRisk: 'Review',
      extractedTextPreview: 'Needs review',
      summary: 'Needs review',
      entities: { horseName: 'Horse One' },
    },
  ];

  const summary = summarizeBatch(batch, documents);
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.processedCount, 2);
  assert.equal(summary.needsReviewCount, 1);
  assert.equal(summary.matchedCount, 1);
  assert.equal(summary.state, 'Reviewing');
});

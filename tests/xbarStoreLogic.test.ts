import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentRecord } from '../src/lib/xbarRuntime.js';
import {
  buildHorseEnrichmentFromEntities,
  composeParentField,
  intakeIdentityChanged,
  summarizeBatch,
  validateAssetPatch,
  validateHorseNoteInput,
  validateLeadInput,
  validateLocationPatch,
  validateNewHorseInput,
} from '../src/store/xbarStoreLogic.js';
import type { DocumentEntities, DocumentRecord, HorseRecord, IntakeBatch } from '../src/types/xbar.js';

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

test('filename parent words do not override fields read from the document', async () => {
  for (const name of ['DAM GOOD', 'SIRE OF THE WIND']) {
    const file = new File(
      [`Registered Name: ${name} Registration Number 1234567 Sire: SHINING SPARK 3344556 Dam: MISS KITTY 7788990`],
      `${name}.txt`,
      { type: 'text/plain' },
    );
    const document = await buildDocumentRecord({
      file,
      uploadedBy: 'Ops Desk',
      source: 'Bulk Intake',
      horses: [],
      existingDocuments: [],
    });
    assert.equal(document.entities.horseName, name);
    assert.equal(document.entities.registrationNumber, '1234567');
    assert.equal(document.entities.sire, 'SHINING SPARK');
    assert.equal(document.entities.dam, 'MISS KITTY');
  }
});

function makeHorse(patch: Partial<HorseRecord> = {}): HorseRecord {
  return {
    registrationNumber: '',
    registry: '',
    owner: '',
    color: '',
    breed: '',
    foaledOn: '',
    bloodline: { sire: '', dam: '', family: '' },
    ...patch,
  } as HorseRecord;
}

test('composeParentField joins a parent name with its registration number', () => {
  assert.equal(composeParentField('SHINING SPARK', '3038883'), 'SHINING SPARK (3038883)');
  assert.equal(composeParentField('DOC BAR', undefined), 'DOC BAR');
  assert.equal(composeParentField('', '123'), '');
});

test('enrichment fills only empty horse fields from extracted document facts', () => {
  const entities: DocumentEntities = {
    registrationNumber: '5544332',
    registry: 'AQHA',
    ownerName: 'Blue River Ranch',
    color: 'Palomino',
    breed: 'Quarter Horse',
    foaledOn: '2021-04-12',
    sire: 'SMART CHIC OLENA',
    sireRegistration: '3120011',
    dam: 'DOCS SUGAR BARS',
    damRegistration: '3220022',
  };
  const { patch, applied } = buildHorseEnrichmentFromEntities(entities, makeHorse());
  assert.equal(patch.registrationNumber, '5544332');
  assert.equal(patch.registry, 'AQHA');
  assert.equal(patch.owner, 'Blue River Ranch');
  assert.equal(patch.color, 'Palomino');
  assert.equal(patch.breed, 'Quarter Horse');
  assert.equal(patch.foaledOn, '2021-04-12');
  assert.equal(patch.sire, 'SMART CHIC OLENA (3120011)');
  assert.equal(patch.dam, 'DOCS SUGAR BARS (3220022)');
  assert.equal(applied.length, 8);
});

test('enrichment never overwrites values the horse already has', () => {
  const horse = makeHorse({
    registrationNumber: '9999999',
    color: 'Bay',
    bloodline: { sire: 'EXISTING SIRE', dam: '', family: '' },
  });
  const entities: DocumentEntities = {
    registrationNumber: '5544332',
    color: 'Palomino',
    sire: 'SMART CHIC OLENA',
    dam: 'DOCS SUGAR BARS',
  };
  const { patch, applied } = buildHorseEnrichmentFromEntities(entities, horse);
  // Existing registration, color, and sire are preserved; only the empty dam fills.
  assert.equal(patch.registrationNumber, undefined);
  assert.equal(patch.color, undefined);
  assert.equal(patch.sire, undefined);
  assert.equal(patch.dam, 'DOCS SUGAR BARS');
  assert.deepEqual(applied, ['dam DOCS SUGAR BARS']);
});

test('enrichment applies nothing when the document carries no new facts', () => {
  const { patch, applied } = buildHorseEnrichmentFromEntities({}, makeHorse({ color: 'Bay' }));
  assert.deepEqual(patch, {});
  assert.deepEqual(applied, []);
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

/*
 * A document intake spans uploads and OCR, long enough for another tab to sign
 * a different account in underneath it. The batch captures who it is for when
 * it starts and checks again before it commits; without that check, account
 * A's documents, extracted facts and workspace storage paths are installed
 * into account B's freshly hydrated workspace and handed to B's next cloud
 * snapshot.
 */
const asAccountA = { userId: 'user-a', workspaceId: 'ranch-a' };

test('an intake that finishes as the account that started it commits', () => {
  assert.equal(intakeIdentityChanged(asAccountA, { userId: 'user-a', workspaceId: 'ranch-a' }), false);
});

test('a different account signing in mid-intake is a change', () => {
  assert.equal(intakeIdentityChanged(asAccountA, { userId: 'user-b', workspaceId: 'ranch-b' }), true);
});

test('the same person switching ranches mid-intake is a change', () => {
  assert.equal(
    intakeIdentityChanged(asAccountA, { userId: 'user-a', workspaceId: 'ranch-b' }),
    true,
    'the workspace decides where the records and their storage paths land, so it is half of the identity',
  );
});

test('a different person on the same workspace id is a change', () => {
  assert.equal(intakeIdentityChanged(asAccountA, { userId: 'user-b', workspaceId: 'ranch-a' }), true);
});

/*
 * Neither direction across the signed-out state is excused. An empty id is a
 * value, not a wildcard: signing out abandons the batch, and a batch begun
 * signed out must not be adopted by whoever signs in while it runs.
 */
test('signing out mid-intake is a change', () => {
  assert.equal(intakeIdentityChanged(asAccountA, { userId: '', workspaceId: '' }), true);
});

test('signing in during an intake that began signed out is a change', () => {
  assert.equal(intakeIdentityChanged({ userId: '', workspaceId: '' }, asAccountA), true);
});

test('a local-only intake, signed out at both ends, still commits', () => {
  assert.equal(
    intakeIdentityChanged({ userId: '', workspaceId: '' }, { userId: '', workspaceId: '' }),
    false,
    'local-first use has no identity to change, and must not be blocked by this check',
  );
});

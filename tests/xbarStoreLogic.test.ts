import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDocumentRecord,
  resolveDocumentHorseMatch,
  conflictingDocumentIdentities,
} from '../src/lib/xbarRuntime.js';
import {
  buildHorseEnrichmentFromEntities,
  composeParentField,
  intakeIdentityChanged,
  photoBatchIdentityChanged,
  isStoragePolicyRefusal,
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

test('intake retains standalone horse names below headings and before explicit parent names', async () => {
  for (const text of [
    'AQHA\nCERTIFICATE OF REGISTRATION\nName: BLUE MOON\nRegistration Number: 1234567',
    'Name: BLUE MOON Registration Number 1234567 Sire: SHINING SPARK Registered Name: SHINING SPARK Registration Number 3344556',
  ]) {
    const document = await buildDocumentRecord({
      file: new File([text], 'registration-paper.txt', { type: 'text/plain' }),
      uploadedBy: 'Ops Desk',
      source: 'Bulk Intake',
      horses: [],
      existingDocuments: [],
    });
    assert.equal(document.entities.horseName, 'BLUE MOON');
    assert.equal(document.entities.registrationNumber, '1234567');
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

test('a photo batch is kept through a profile reload, and dropped for a real account change', () => {
  const target = { userId: 'user-a', workspaceId: 'ws-a' };
  // Same account, access profile momentarily blank after a token refresh: the
  // photos are already filed under ws-a and must be attached, not stranded.
  assert.equal(photoBatchIdentityChanged(target, { userId: 'user-a', workspaceId: '' }), false);
  assert.equal(photoBatchIdentityChanged(target, { userId: 'user-a', workspaceId: 'ws-a' }), false);
  // A different ranch, a different account, or a sign-out is a change.
  assert.equal(photoBatchIdentityChanged(target, { userId: 'user-a', workspaceId: 'ws-b' }), true);
  assert.equal(photoBatchIdentityChanged(target, { userId: 'user-b', workspaceId: 'ws-a' }), true);
  assert.equal(photoBatchIdentityChanged(target, { userId: '', workspaceId: '' }), true);
  // Document intake keeps its stricter rule: a blank workspace is a change there.
  assert.equal(intakeIdentityChanged(target, { userId: 'user-a', workspaceId: '' }), true);
});

test('a storage policy refusal is told apart from a connection failure', () => {
  assert.equal(isStoragePolicyRefusal({ status: 403, message: 'new row violates row-level security policy' }), true);
  assert.equal(isStoragePolicyRefusal({ statusCode: '403', message: 'Unauthorized' }), true);
  assert.equal(isStoragePolicyRefusal({ status: 400, message: 'new row violates row-level security policy' }), true);
  assert.equal(isStoragePolicyRefusal({ status: 500, message: 'Internal Server Error' }), false);
  assert.equal(isStoragePolicyRefusal(new TypeError('Failed to fetch')), false);
  assert.equal(isStoragePolicyRefusal(null), false);
});

// The reader must identify the subject of the paper, not an existing horse
// mentioned as a parent, and must refuse contradictory or ambiguous matches.
const identityHorse = (id: string, name: string, registrationNumber = '', owner = '') =>
  makeHorse({ id, name, barnName: name, registrationNumber, aqhaNumber: '', owner, ownerEntity: owner });

const INTAKE_IDENTITY_CASES = [
  {
    name: 'long numeric registration is not reduced to another horse identity',
    horses: [identityHorse('wrong', 'BLUE MOON', '12345678901234')],
    text: 'Registered Name: BLUE MOON\nRegistration Number: 12345678901234567',
    horseName: 'BLUE MOON',
    horseId: undefined,
  },
  {
    name: 'conflicting labels on one paper require review instead of taking the first',
    horses: [identityHorse('wrong', 'BLUE MOON', '1234567')],
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567\nRegistered Name: RED SUN\nRegistration Number: 7654321',
    horseName: 'BLUE MOON',
    horseId: undefined,
  },
  {
    name: 'legacy AQHA evidence still prevents a different registry match',
    horses: [{ ...identityHorse('wrong', 'BLUE MOON', '1234567'), aqhaNumber: 'AQHA1234567' }],
    text: 'Registered Name: BLUE MOON\nRegistration Number: APHA1234567',
    horseName: 'BLUE MOON',
    horseId: undefined,
  },
  {
    name: 'document and stored registration suffixes remain distinct',
    horses: [identityHorse('wrong', 'BLUE MOON', '1234567AA')],
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567AB',
    horseName: 'BLUE MOON',
    horseId: undefined,
  },
  {
    name: 'a horse name inside an owner organization does not identify the subject',
    horses: [identityHorse('wrong', 'BLUE MOON')],
    text: 'Owner: Blue Moon Ranch\nCoggins test result: Negative',
    horseName: undefined,
    horseId: undefined,
  },
  {
    name: 'a known short name inside a parent name does not identify the subject',
    horses: [identityHorse('wrong', 'SPARK')],
    text: 'Sire: SHINING SPARK 3344556',
    horseName: undefined,
    horseId: undefined,
  },
  {
    name: 'a parent barn alias does not identify the subject',
    horses: [{ ...identityHorse('wrong', 'SHINING STAR'), barnName: 'SPARK' }],
    text: 'Sire: SPARK',
    horseName: undefined,
    horseId: undefined,
  },
  {
    name: 'a wrapped owner name is still not the subject',
    horses: [identityHorse('wrong', 'BLUE MOON')],
    text: 'Owner:\nBLUE MOON\nCoggins test result: Negative',
    horseName: undefined,
    horseId: undefined,
  },

  {
    name: 'equal numeric registrations from different registries are not a match',
    horses: [identityHorse('wrong', 'BLUE MOON', 'APHA1234567')],
    text: 'Registered Name: BLUE MOON\nRegistration Number: AQHA1234567',
    horseName: 'BLUE MOON',
    horseId: undefined,
  },
  {
    name: 'parent-only text is not a subject match',
    horses: [identityHorse('sire', 'SHINING SPARK', '3344556')],
    text: 'Sire: SHINING SPARK 3344556',
    horseName: undefined,
    horseId: undefined,
  },
  {
    name: 'registry-prefixed stored numbers use the extractor convention',
    horses: [identityHorse('right', 'BLUE MOON', 'AQHA1234567')],
    text: 'Registered Name: BLUE MOON\nRegistration Number: AQHA1234567',
    horseName: 'BLUE MOON',
    horseId: 'right',
  },
  {
    name: 'two unlabelled subjects are ambiguous even with different name lengths',
    horses: [identityHorse('first', 'BLUE MOON'), identityHorse('second', 'RED SUNSHINE')],
    text: 'BLUE MOON and RED SUNSHINE veterinary appointment',
    horseName: undefined,
    horseId: undefined,
  },
  {
    name: 'a known sire never replaces the labeled subject',
    horses: [identityHorse('sire', 'SHINING SPARK', '3344556')],
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567\nSire: SHINING SPARK 3344556',
    horseName: 'BLUE MOON',
    horseId: undefined,
  },
  {
    name: 'a filename naming an existing horse cannot replace the labeled subject',
    horses: [identityHorse('wrong', 'SHINING SPARK', '3344556')],
    filename: 'SHINING SPARK registration.txt',
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567',
    horseName: 'BLUE MOON',
    horseId: undefined,
  },
  {
    name: 'a shared name with conflicting registration stays unassigned',
    horses: [identityHorse('wrong', 'BLUE MOON', '7654321')],
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567',
    horseName: 'BLUE MOON',
    horseId: undefined,
  },
  {
    name: 'a shared registration with conflicting name stays unassigned',
    horses: [identityHorse('wrong', 'RED SUN', '1234567')],
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567',
    horseName: 'BLUE MOON',
    horseId: undefined,
  },
  {
    name: 'a matching name and registration selects the right same-name horse',
    horses: [identityHorse('wrong', 'BLUE MOON', '7654321'), identityHorse('right', 'BLUE MOON', '1234567')],
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567',
    horseName: 'BLUE MOON',
    horseId: 'right',
  },
  {
    name: 'two indistinguishable profiles require manual assignment',
    horses: [identityHorse('first', 'BLUE MOON', '1234567'), identityHorse('second', 'BLUE MOON', '1234567')],
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567',
    horseName: 'BLUE MOON',
    horseId: undefined,
  },
  {
    name: 'an owner shared by the herd is not horse identity',
    horses: [identityHorse('first', 'BLUE MOON', '1234567', 'Blue River Ranch')],
    text: 'Owner: Blue River Ranch\nCoggins test result: Negative',
    horseName: undefined,
    horseId: undefined,
  },
  {
    name: 'a known name appearing only inside a longer name is not a match',
    horses: [identityHorse('wrong', 'STAR', '1234567')],
    text: 'STARLIGHT veterinary note',
    horseName: undefined,
    horseId: undefined,
  },
  {
    name: 'unique unlabelled OCR name evidence still matches',
    horses: [identityHorse('right', 'BLUE MOON')],
    text: 'Coggins test\nHorse: BLUE MOON\nResult: Negative',
    horseName: 'BLUE MOON',
    horseId: 'right',
  },
] as const;

for (const fixture of INTAKE_IDENTITY_CASES) {
  test(`document identity: ${fixture.name}`, async () => {
    const record = await buildDocumentRecord({
      file: new File([fixture.text], 'filename' in fixture ? fixture.filename : 'scan-001.txt', { type: 'text/plain' }),
      uploadedBy: 'Synthetic test',
      source: 'Bulk Intake',
      horses: [...fixture.horses],
      existingDocuments: [],
    });
    assert.equal(record.entities.horseName, fixture.horseName);
    assert.equal(record.horseId, fixture.horseId);
    if (!fixture.horseId) assert.equal(record.state, 'Needs Review');
  });
}

test('document identity: a missing field is not reported as extracted from the profile', async () => {
  const horse = identityHorse('right', 'BLUE MOON', '1234567', 'Blue River Ranch');
  horse.color = 'Palomino';
  horse.bloodline.sire = 'KNOWN SIRE';
  const record = await buildDocumentRecord({
    file: new File(['Registered Name: BLUE MOON\nRegistration Number: 1234567'], 'scan-001.txt', {
      type: 'text/plain',
    }),
    uploadedBy: 'Synthetic test',
    source: 'Bulk Intake',
    horses: [horse],
    existingDocuments: [],
  });
  assert.equal(record.horseId, horse.id);
  assert.equal(record.entities.color, undefined);
  assert.equal(record.entities.sire, undefined);
  assert.equal(record.entities.ownerName, undefined);
});

test('document identity: manually selected conflicting horse stays in review with original facts', async () => {
  const horse = identityHorse('selected', 'RED SUN', '7654321');
  const record = await buildDocumentRecord({
    file: new File(['Registered Name: BLUE MOON\nRegistration Number: 1234567'], 'scan-001.txt', {
      type: 'text/plain',
    }),
    uploadedBy: 'Synthetic test',
    source: 'Manual Upload',
    selectedHorse: horse,
    horses: [horse],
    existingDocuments: [],
  });
  assert.equal(record.horseId, horse.id, 'honor the explicit assignment without claiming the identities agree');
  assert.equal(record.state, 'Needs Review');
  assert.equal(record.entities.horseName, 'BLUE MOON');
  assert.equal(record.entities.registrationNumber, '1234567');
});

test('review identity decision distinguishes no match from conflicting or ambiguous profiles', () => {
  const entities = { horseName: 'BLUE MOON', registrationNumber: '1234567' };
  assert.deepEqual(resolveDocumentHorseMatch([], '', entities), { match: undefined, needsReview: false });
  assert.deepEqual(resolveDocumentHorseMatch([identityHorse('conflict', 'BLUE MOON', '7654321')], '', entities), {
    match: undefined,
    needsReview: true,
  });
  assert.deepEqual(
    resolveDocumentHorseMatch(
      [identityHorse('first', 'BLUE MOON', '1234567'), identityHorse('second', 'BLUE MOON', '1234567')],
      '',
      entities,
    ),
    { match: undefined, needsReview: true },
  );
  const resolved = resolveDocumentHorseMatch(
    [identityHorse('wrong', 'BLUE MOON', '7654321'), identityHorse('right', 'BLUE MOON', '1234567')],
    '',
    entities,
  );
  assert.equal(resolved.match?.horse.id, 'right');
  assert.equal(resolved.needsReview, false);
});

test('review identity decision refuses a barn alias with contradictory registration', () => {
  const horse = { ...identityHorse('wrong', 'BLUE MOON', '7654321'), barnName: 'SPARK' };
  assert.deepEqual(resolveDocumentHorseMatch([horse], '', { horseName: 'SPARK', registrationNumber: '1234567' }), {
    match: undefined,
    needsReview: true,
  });
});

test('registered names cannot silently outrank another horse with the same barn alias', () => {
  const horses = [
    identityHorse('registered', 'BLUE MOON'),
    { ...identityHorse('alias', 'RED SUN'), barnName: 'BLUE MOON' },
  ];
  assert.deepEqual(resolveDocumentHorseMatch(horses, '', { horseName: 'BLUE MOON' }), {
    match: undefined,
    needsReview: true,
  });
});

test('unfamiliar registration suffixes are compared in full, not parser-truncated', () => {
  assert.deepEqual(
    resolveDocumentHorseMatch([identityHorse('wrong', 'BLUE MOON', '1234567AA')], '', {
      horseName: 'BLUE MOON',
      registrationNumber: '1234567AB',
    }),
    { match: undefined, needsReview: true },
  );
});

test('batch profile creation refuses contradictory subject fields across documents', () => {
  assert.equal(conflictingDocumentIdentities([{ horseName: 'BLUE MOON' }, { horseName: 'blue moon' }]), false);
  assert.equal(conflictingDocumentIdentities([{ horseName: 'BLUE MOON' }, { horseName: 'RED SUN' }]), true);
  assert.equal(
    conflictingDocumentIdentities([{ registrationNumber: '1234567' }, { registrationNumber: '7654321' }]),
    true,
  );
  assert.equal(
    conflictingDocumentIdentities([{ registrationNumber: 'AQHA1234567' }, { registrationNumber: '1234567' }]),
    false,
  );
  assert.equal(
    conflictingDocumentIdentities([{ registrationNumber: 'AQHA1234567' }, { registrationNumber: 'APHA1234567' }]),
    true,
  );
});

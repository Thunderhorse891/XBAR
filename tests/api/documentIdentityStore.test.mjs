import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createEmptyWorkspaceState, createHorseRecord } from '../../src/store/xbarStoreHelpers.ts';
import { useXbarStore } from '../../src/store/useXbarStore.ts';

// Synthetic local-mode store tests. File-vault writes deliberately fail in Node
// (no IndexedDB); no real document, external OCR provider or cloud write is used.
await new Promise((resolve) => setImmediate(resolve));
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const profile = {
  ...createEmptyWorkspaceState().workspaceProfile,
  defaultOwnerName: 'Synthetic Ranch',
  ranchManagerName: 'Synthetic',
};
const horse = (name, registrationNumber, barnName = name) =>
  createHorseRecord(
    {
      name,
      barnName,
      registrationNumber,
      sex: 'Mare',
      segment: 'Sale Prospect',
      status: 'Sale Prep',
      owner: 'Synthetic Ranch',
      ownerEntity: 'Synthetic Ranch',
      barn: 'Test',
      pasture: '',
    },
    profile,
  );
const paper = (name, registrationNumber) =>
  new File([`Registered Name: ${name}\nRegistration Number: ${registrationNumber}`], 'scan.txt', {
    type: 'text/plain',
  });
const intake = (files, createHorseFromBatch = true) =>
  useXbarStore
    .getState()
    .createDocumentIntake({ files, source: 'Bulk Intake', uploadedBy: 'Synthetic', createHorseFromBatch });

beforeEach((context) => {
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: 'Admin', workspaceProfile: profile });
  const original = console.error;
  context.mock.method(console, 'error', (message, ...args) => {
    if (String(message).startsWith('On-device file storage failed;')) return;
    original(message, ...args);
  });
});

test('bulk creation does not duplicate a case-variant name with contradictory registration', async () => {
  const existing = horse('Blue Moon', '7654321');
  useXbarStore.setState({ horses: [existing] });
  const result = await intake([paper('BLUE MOON', '1234567')]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.createdHorseIds, []);
  assert.equal(useXbarStore.getState().horses.length, 1);
  assert.equal(useXbarStore.getState().documents[0].horseId, undefined);
  assert.equal(useXbarStore.getState().documents[0].state, 'Needs Review');
});

test('bulk creation keeps registered-name and barn-alias ambiguity in review', async () => {
  useXbarStore.setState({ horses: [horse('BLUE MOON', ''), horse('RED SUN', '', 'BLUE MOON')] });
  const result = await intake([new File(['Horse: BLUE MOON'], 'scan.txt', { type: 'text/plain' })]);
  assert.deepEqual(result.createdHorseIds, []);
  assert.equal(useXbarStore.getState().horses.length, 2);
  assert.equal(useXbarStore.getState().documents[0].horseId, undefined);
});

test('a shared registration cannot merge contradictory subject names into one new profile', async () => {
  const result = await intake([paper('BLUE MOON', '1234567'), paper('RED SUN', '1234567')]);
  assert.deepEqual(result.createdHorseIds, []);
  assert.equal(useXbarStore.getState().horses.length, 0);
  assert.equal(useXbarStore.getState().documents.length, 2);
  assert.ok(
    useXbarStore.getState().documents.every((document) => !document.horseId && document.state === 'Needs Review'),
  );
});

test('review retry refuses conflict, then rechecks the current herd without creating a duplicate', async () => {
  useXbarStore.setState({ horses: [horse('BLUE MOON', '7654321')] });
  await intake([paper('BLUE MOON', '1234567')], false);
  const documentId = useXbarStore.getState().documents[0].id;
  const refused = useXbarStore.getState().createHorseFromDocument(documentId);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /conflicting or ambiguous/);
  assert.equal(useXbarStore.getState().documents[0].horseId, undefined);
  const correct = horse('BLUE MOON', '1234567');
  useXbarStore.setState({ horses: [...useXbarStore.getState().horses, correct] });
  const retried = useXbarStore.getState().createHorseFromDocument(documentId);
  assert.equal(retried.ok, true);
  assert.equal(retried.id, correct.id);
  assert.equal(useXbarStore.getState().horses.length, 2);
});

test('creating and approving a profile never backfills source facts from workspace defaults', async () => {
  await intake([paper('BLUE MOON', '1234567')]);
  const { documents, horses } = useXbarStore.getState();
  const sourceFacts = { horseName: 'BLUE MOON', registrationNumber: '1234567' };
  assert.deepEqual(JSON.parse(JSON.stringify(documents[0].entities)), sourceFacts);
  assert.equal(horses[0].owner, '', 'Workspace default is not evidence of this horse owner');
  assert.deepEqual(horses[0].ownership, [], 'OCR cannot invent ownership shares or legal authority');
  const result = useXbarStore.getState().reviewDocument(documents[0].id, horses[0].id);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(useXbarStore.getState().documents[0].entities)), sourceFacts);
});

test('file-vault failure is disclosed and does not wedge a repeated intake', async () => {
  for (let index = 0; index < 2; index += 1) {
    const result = await intake([paper(`SYNTHETIC ${index}`, `123456${index}`)], false);
    assert.equal(result.ok, true);
    assert.match(result.message, /metadata only/);
    assert.equal(useXbarStore.getState().documentIntakeProgress, null);
  }
  assert.equal(useXbarStore.getState().documents.length, 2);
  assert.ok(useXbarStore.getState().documents.every((document) => !document.localFileKey && !document.storagePath));
});

test('one paper with conflicting subject labels cannot auto-link, create or approve', async () => {
  const existing = horse('BLUE MOON', '1234567');
  useXbarStore.setState({ horses: [existing] });
  const result = await intake([
    new File(
      [
        'Registered Name: BLUE MOON\nRegistration Number: 1234567\nRegistered Name: RED SUN\nRegistration Number: 7654321',
      ],
      'two-horses.txt',
      { type: 'text/plain' },
    ),
  ]);
  assert.deepEqual(result.createdHorseIds, []);
  const document = useXbarStore.getState().documents[0];
  assert.equal(document.horseId, undefined);
  assert.equal(document.identityReviewRequired, true);
  assert.equal(JSON.parse(JSON.stringify(document)).identityReviewRequired, true);
  assert.match(document.processingNote, /Conflicting horse identities/);
  assert.equal(useXbarStore.getState().createHorseFromDocument(document.id).ok, false);
  assert.equal(useXbarStore.getState().reviewDocument(document.id, existing.id).ok, false);
  assert.equal(useXbarStore.getState().horses.length, 1);
});

test('identical renamed files in one batch remain visible and route to duplicate review without creating a horse', async () => {
  const bytes = 'CERTIFICATE OF REGISTRATION\nRegistered Name: BLUE MOON\nRegistration Number: 7654321';
  const result = await intake([
    new File([bytes], 'first.txt', { type: 'text/plain' }),
    new File([bytes], 'copy.txt', { type: 'text/plain' }),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.duplicateCount, 1);
  assert.equal(useXbarStore.getState().documents.length, 2);
  assert.equal(useXbarStore.getState().documents[1].duplicateRisk, 'Possible Duplicate');
  assert.equal(useXbarStore.getState().horses.length, 0);
  assert.match(result.message, /No files were removed/);
});

test('a mixed batch preserves its duplicate warning even while creating two new horses', async () => {
  const original = new File(
    ['CERTIFICATE OF REGISTRATION\nRegistered Name: Existing Horse\nRegistration Number: 1234567'],
    'original.txt',
    { type: 'text/plain' },
  );
  await intake([original]);
  const result = await intake([
    new File([await original.text()], 'renamed.txt', { type: 'text/plain' }),
    new File(['CERTIFICATE OF REGISTRATION\nRegistered Name: New Alpha\nRegistration Number: 7654321'], 'alpha.txt', {
      type: 'text/plain',
    }),
    new File(['CERTIFICATE OF REGISTRATION\nRegistered Name: New Beta\nRegistration Number: 7654322'], 'beta.txt', {
      type: 'text/plain',
    }),
  ]);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.createdHorseIds.length, 2);
  const { readFile } = await import('node:fs/promises');
  const route = await readFile('src/routes/Documents.tsx', 'utf8');
  assert.match(
    route,
    /if \(result\.duplicateCount \|\| result\.heldForReviewCount\) \{\s*goToStage\('Review'\);\s*\} else if \(createdHorseIds\.length === 1\)[\s\S]*?\} else if \(createdHorseIds\.length > 1\)/,
    'New profiles must not override the duplicate review destination',
  );
});

test('complementary registration and name-only sale papers create one profile with both sources', async () => {
  const result = await intake([
    new File(
      ['CERTIFICATE OF REGISTRATION\nRegistered Name: BLUE MOON\nRegistration Number: 7654321\nSire: SHINING SPARK'],
      'registration.txt',
      { type: 'text/plain' },
    ),
    new File(
      ['BILL OF SALE\nRegistered Name: BLUE MOON\nSex: Mare\nColor: Bay\nOwner: Synthetic Ranch'],
      'bill-of-sale.txt',
      { type: 'text/plain' },
    ),
  ]);
  assert.equal(result.createdHorseIds.length, 1);
  assert.equal(result.heldForReviewCount, 0, 'Attached sources do not steal the valid profile destination');
  const state = useXbarStore.getState();
  assert.equal(state.horses.length, 1);
  assert.equal(state.horses[0].registrationNumber, '7654321');
  assert.equal(state.horses[0].bloodline.sire, 'SHINING SPARK');
  assert.equal(state.horses[0].color, 'Bay');
  assert.equal(state.horses[0].owner, 'Synthetic Ranch');
  assert.equal(state.horses[0].documents.length, 2);
  assert.equal(state.documents.length, 2);
  assert.ok(state.documents.every((document) => document.horseId === state.horses[0].id));
  assert.equal(
    state.documents[0].entities.ownerName,
    undefined,
    'The source must not be backfilled from the other paper',
  );
  assert.equal(
    state.documents[1].entities.registrationNumber,
    undefined,
    'Each document keeps its own extracted facts',
  );
});

const sourceFile = (title, lines) => new File([lines.join('\n')], title, { type: 'text/plain' });
for (const reverse of [false, true]) {
  test(`batch identity combines canonical registration and name variants (reverse=${reverse})`, async () => {
    const files = [
      sourceFile('registered.txt', [
        'CERTIFICATE OF REGISTRATION',
        'Registered Name: BLUE-MOON',
        'Registration Number: AQHA 7654321',
        'Sire: SHINING SPARK',
      ]),
      sourceFile('support.txt', ['BILL OF SALE', 'Registered Name: blue moon', 'Color: Bay', 'Sex: Mare']),
    ];
    const result = await intake(reverse ? files.reverse() : files);
    assert.equal(result.createdHorseIds.length, 1);
    const state = useXbarStore.getState();
    assert.equal(state.horses[0].color, 'Bay');
    assert.equal(state.horses[0].bloodline.sire, 'SHINING SPARK');
    assert.equal(state.horses[0].documents.length, 2);
    assert.ok(state.documents.every((document) => document.horseId === state.horses[0].id));
  });
}

test('a registration-only source joins its named source using the canonical number', async () => {
  const result = await intake([
    sourceFile('identity.txt', [
      'CERTIFICATE OF REGISTRATION',
      'Registration Number: AQHA 7654321',
      'Sire: SHINING SPARK',
    ]),
    sourceFile('named.txt', [
      'BILL OF SALE',
      'Registered Name: BLUE MOON',
      'Registration Number: 7654321',
      'Color: Bay',
    ]),
  ]);
  assert.equal(result.createdHorseIds.length, 1);
  assert.equal(useXbarStore.getState().horses[0].name, 'BLUE MOON');
  assert.equal(useXbarStore.getState().horses[0].bloodline.sire, 'SHINING SPARK');
  assert.equal(useXbarStore.getState().documents.length, 2);
});

for (const [label, first, second] of [
  [
    'registration numbers',
    ['Registered Name: BLUE MOON', 'Registration Number: 7654321'],
    ['Registered Name: BLUE MOON', 'Registration Number: 7654322'],
  ],
  [
    'subject names',
    ['Registered Name: BLUE MOON', 'Registration Number: 7654321'],
    ['Registered Name: RED SUN', 'Registration Number: 7654321'],
  ],
  [
    'sire names',
    ['Registered Name: BLUE MOON', 'Registration Number: 7654321', 'Sire: SHINING SPARK'],
    ['Registered Name: BLUE MOON', 'Sire: DIFFERENT STALLION'],
  ],
  [
    'source colors',
    ['Registered Name: BLUE MOON', 'Registration Number: 7654321', 'Color: Bay'],
    ['Registered Name: BLUE MOON', 'Color: Sorrel'],
  ],
]) {
  test(`conflicting ${label} stay in review with both originals and no guessed profile`, async () => {
    const result = await intake([sourceFile('first.txt', first), sourceFile('second.txt', second)]);
    assert.deepEqual(result.createdHorseIds, []);
    assert.equal(useXbarStore.getState().horses.length, 0);
    assert.equal(useXbarStore.getState().documents.length, 2);
    assert.ok(
      useXbarStore
        .getState()
        .documents.every((document) => document.state === 'Needs Review' && document.batchReviewNote),
    );
    assert.match(result.message, /files need source review/);
  });
}

test('name-only related sources request identity review instead of silently merging two horses', async () => {
  const result = await intake([
    sourceFile('sale.txt', ['BILL OF SALE', 'Registered Name: BLUE MOON', 'Color: Bay']),
    sourceFile('health.txt', ['VACCINATION RECORD', 'Registered Name: BLUE MOON', 'Sex: Mare']),
  ]);
  assert.deepEqual(result.createdHorseIds, []);
  assert.ok(
    useXbarStore.getState().documents.every((document) => /without a registration/.test(document.batchReviewNote)),
  );
});

test('repeating a complementary batch never adds a second profile or drops its source files', async () => {
  const files = [
    sourceFile('registered.txt', [
      'CERTIFICATE OF REGISTRATION',
      'Registered Name: BLUE MOON',
      'Registration Number: 7654321',
    ]),
    sourceFile('sale.txt', ['BILL OF SALE', 'Registered Name: BLUE MOON', 'Color: Bay']),
  ];
  await intake(files);
  const result = await intake(files);
  assert.deepEqual(result.createdHorseIds, []);
  assert.equal(useXbarStore.getState().horses.length, 1);
  assert.equal(useXbarStore.getState().documents.length, 4);
  assert.equal(result.duplicateCount, 2);
});

test('a matching filename with no readable horse identity cannot create a second profile', async () => {
  const result = await intake([
    sourceFile('registration.txt', [
      'CERTIFICATE OF REGISTRATION',
      'Registered Name: BLUE MOON',
      'Registration Number: 7654321',
    ]),
    sourceFile('BLUE MOON.txt', ['BILL OF SALE', 'Owner: Synthetic Ranch']),
  ]);
  assert.equal(result.createdHorseIds.length, 1);
  const state = useXbarStore.getState();
  assert.equal(state.documents.length, 2);
  assert.equal(state.documents[1].horseId, undefined);
  assert.match(state.documents[1].batchReviewNote, /filename is not identity evidence/);
});

test('out-of-order document reads keep one profile and stable source association', async () => {
  const completed = [];
  const registration = sourceFile('delayed-registration.txt', [
    'CERTIFICATE OF REGISTRATION',
    'Registered Name: BLUE MOON',
    'Registration Number: 7654321',
  ]);
  const sale = sourceFile('quick-sale.txt', ['BILL OF SALE', 'Registered Name: BLUE MOON', 'Color: Bay']);
  const registrationText = registration.text.bind(registration);
  const saleText = sale.text.bind(sale);
  registration.text = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    completed.push('registration');
    return registrationText();
  };
  sale.text = async () => {
    completed.push('sale');
    return saleText();
  };
  const result = await intake([registration, sale]);
  assert.deepEqual(completed, ['sale', 'registration']);
  assert.equal(result.createdHorseIds.length, 1);
  const state = useXbarStore.getState();
  assert.equal(state.horses[0].color, 'Bay');
  assert.deepEqual(
    state.documents.map((document) => document.title),
    ['delayed-registration', 'quick-sale'],
  );
  assert.ok(state.documents.every((document) => document.horseId === state.horses[0].id));
});

test('one valid profile plus contradictory source group exposes review work without losing any source', async () => {
  const sources = [
    ['good-source.txt', 'GOOD HORSE', '9990001'],
    ['conflict-one.txt', 'CONFLICT HORSE', '9990002'],
    ['conflict-two.txt', 'CONFLICT HORSE', '9990003'],
  ].map(
    ([name, horseName, registration]) =>
      new File(
        [`CERTIFICATE OF REGISTRATION\nRegistered Name: ${horseName}\nRegistration Number: ${registration}`],
        name,
        { type: 'text/plain' },
      ),
  );
  const result = await intake(sources);
  assert.equal(result.ok, true);
  assert.equal(result.createdHorseIds.length, 1);
  assert.equal(result.duplicateCount, 0);
  assert.equal(useXbarStore.getState().documents.length, 3);
  assert.equal(useXbarStore.getState().horses[0].name, 'GOOD HORSE');
  assert.equal(useXbarStore.getState().documents.filter((document) => document.batchReviewNote).length, 2);
  assert.equal(result.heldForReviewCount, 2, 'Callers need the held count before choosing the destination');
  const { readFile } = await import('node:fs/promises');
  const route = await readFile('src/routes/Documents.tsx', 'utf8');
  const drawer = await readFile('src/components/saas/flows.tsx', 'utf8');
  assert.match(route, /if \(result\.duplicateCount \|\| result\.heldForReviewCount\) \{\s*goToStage\('Review'\)/);
  assert.match(
    drawer,
    /const destination =\s*result\.duplicateCount \|\| result\.heldForReviewCount\s*\? '\/documents\?stage=Review'/,
  );
});

test('one valid profile plus one internally conflicting source still exposes unassigned review work', async () => {
  const result = await intake([
    new File(['Registered Name: GOOD HORSE\nRegistration Number: 9990001'], 'good.txt', { type: 'text/plain' }),
    new File(
      [
        'Registered Name: BLUE MOON\nRegistration Number: 1234567\nRegistered Name: RED SUN\nRegistration Number: 7654321',
      ],
      'conflicting-subjects.txt',
      { type: 'text/plain' },
    ),
  ]);
  assert.equal(result.createdHorseIds.length, 1);
  assert.equal(result.duplicateCount, 0);
  const held = useXbarStore.getState().documents.find((document) => document.identityReviewRequired);
  assert.ok(held);
  assert.equal(held.horseId, undefined);
  assert.equal(held.state, 'Needs Review');
  assert.equal(useXbarStore.getState().documents.length, 2);
  assert.equal(result.heldForReviewCount, 1);
});

for (const [label, source, entities] of [
  ['stale name', 'Registered Name: RED SUN\nRegistration Number: 1234567', {}],
  ['stale registration', 'Registered Name: BLUE MOON\nRegistration Number: 7654321', {}],
  [
    'stale sire',
    'Registered Name: BLUE MOON\nRegistration Number: 1234567\nSire: OTHER SIRE',
    { sire: 'EXPECTED SIRE' },
  ],
  [
    'conflicting microchips',
    'Registered Name: BLUE MOON\nRegistration Number: 1234567\nMicrochip: 985000000000001\nMicrochip: 985000000000002',
    {},
  ],
]) {
  for (const existingMatch of [false, true]) {
    test(`creation screens ${label} before ${existingMatch ? 'existing attachment' : 'new records'}, including retries`, async () => {
      await intake([paper('BLUE MOON', '1234567')], false);
      const document = {
        ...useXbarStore.getState().documents[0],
        extractedTextPreview: source,
        entities: { horseName: 'BLUE MOON', registrationNumber: '1234567', ...entities },
        identityReviewRequired: undefined,
      };
      const unrelated = horse('UNRELATED HORSE', '9990001');
      const existing = horse('BLUE MOON', '1234567');
      const { createOwnershipRecord } = await import('../../src/store/xbarStoreLogic.ts');
      const horses = existingMatch ? [unrelated, existing] : [unrelated];
      useXbarStore.setState({ documents: [document], horses, ownershipRecords: horses.map(createOwnershipRecord) });
      const before = structuredClone({
        horses: useXbarStore.getState().horses,
        ownershipRecords: useXbarStore.getState().ownershipRecords,
        documents: useXbarStore.getState().documents,
      });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = useXbarStore.getState().createHorseFromDocument(document.id);
        assert.equal(result.ok, false, 'Conflicting fresh source must not succeed');
        assert.match(result.message, /source|identit|microchip/i);
        assert.deepEqual(useXbarStore.getState().horses, before.horses);
        assert.deepEqual(useXbarStore.getState().ownershipRecords, before.ownershipRecords);
        assert.deepEqual(useXbarStore.getState().documents, before.documents);
      }
    });
  }
}

test('bulk creation holds conflicting microchips without adding or changing horse and ownership records', async () => {
  const existing = horse('UNRELATED HORSE', '9990001');
  const { createOwnershipRecord } = await import('../../src/store/xbarStoreLogic.ts');
  useXbarStore.setState({ horses: [existing], ownershipRecords: [createOwnershipRecord(existing)] });
  const before = structuredClone({
    horses: useXbarStore.getState().horses,
    ownershipRecords: useXbarStore.getState().ownershipRecords,
  });
  const result = await intake([
    sourceFile('conflicting-chips.txt', [
      'Registered Name: BLUE MOON',
      'Registration Number: 1234567',
      'Microchip: 985000000000001',
      'Microchip: 985000000000002',
    ]),
  ]);
  assert.deepEqual(result.createdHorseIds, []);
  assert.deepEqual(useXbarStore.getState().horses, before.horses);
  assert.deepEqual(useXbarStore.getState().ownershipRecords, before.ownershipRecords);
  assert.equal(result.heldForReviewCount, 1);
  assert.equal(useXbarStore.getState().documents[0].horseId, undefined);
  assert.equal(useXbarStore.getState().documents[0].state, 'Needs Review');
});

test('fresh compatible source still creates one horse and one ownership record; retry cannot duplicate them', async () => {
  await intake([paper('BLUE MOON', '1234567')], false);
  const id = useXbarStore.getState().documents[0].id;
  const result = useXbarStore.getState().createHorseFromDocument(id);
  assert.equal(result.ok, true);
  assert.equal(useXbarStore.getState().horses.length, 1);
  assert.equal(useXbarStore.getState().ownershipRecords.length, 1);
  const before = structuredClone({
    horses: useXbarStore.getState().horses,
    ownershipRecords: useXbarStore.getState().ownershipRecords,
  });
  assert.equal(useXbarStore.getState().createHorseFromDocument(id).ok, false);
  assert.deepEqual(useXbarStore.getState().horses, before.horses);
  assert.deepEqual(useXbarStore.getState().ownershipRecords, before.ownershipRecords);
});

test('grouped sources with different single microchips cannot create horse or ownership records', async () => {
  const result = await intake([
    sourceFile('first-chip.txt', [
      'Registered Name: BLUE MOON',
      'Registration Number: 1234567',
      'Microchip: 985000000000001',
    ]),
    sourceFile('second-chip.txt', [
      'Registered Name: BLUE MOON',
      'Registration Number: 1234567',
      'Microchip: 985000000000002',
    ]),
  ]);
  assert.deepEqual(result.createdHorseIds, []);
  assert.deepEqual(useXbarStore.getState().horses, []);
  assert.deepEqual(useXbarStore.getState().ownershipRecords, []);
  assert.equal(result.heldForReviewCount, 2);
  assert.ok(
    useXbarStore.getState().documents.every((document) => !document.horseId && document.state === 'Needs Review'),
  );
});

test('existing match is screened against its own microchip before attaching a source', async () => {
  await intake(
    [
      sourceFile('one-chip.txt', [
        'Registered Name: BLUE MOON',
        'Registration Number: 1234567',
        'Microchip: 985000000000001',
      ]),
    ],
    false,
  );
  const existing = { ...horse('BLUE MOON', '1234567'), microchipId: '985000000000002' };
  const { createOwnershipRecord } = await import('../../src/store/xbarStoreLogic.ts');
  useXbarStore.setState({ horses: [existing], ownershipRecords: [createOwnershipRecord(existing)] });
  const before = structuredClone({
    horses: useXbarStore.getState().horses,
    ownershipRecords: useXbarStore.getState().ownershipRecords,
    documents: useXbarStore.getState().documents,
  });
  const result = useXbarStore.getState().createHorseFromDocument(before.documents[0].id);
  assert.equal(result.ok, false);
  assert.deepEqual(useXbarStore.getState().horses, before.horses);
  assert.deepEqual(useXbarStore.getState().ownershipRecords, before.ownershipRecords);
  assert.deepEqual(useXbarStore.getState().documents, before.documents);
});

for (const [label, patch] of [
  ['archived', { state: 'Archived' }],
  ['queued', { state: 'Queued' }],
  ['identity review', { identityReviewRequired: true }],
]) {
  test(`creation preserves the ${label} gate without changing records`, async () => {
    await intake([paper('BLUE MOON', '1234567')], false);
    const document = { ...useXbarStore.getState().documents[0], ...patch };
    useXbarStore.setState({ documents: [document] });
    assert.equal(useXbarStore.getState().createHorseFromDocument(document.id).ok, false);
    assert.deepEqual(useXbarStore.getState().horses, []);
    assert.deepEqual(useXbarStore.getState().ownershipRecords, []);
    assert.deepEqual(useXbarStore.getState().documents, [document]);
  });
}

test('creation preserves role denial without changing records', async () => {
  await intake([paper('BLUE MOON', '1234567')], false);
  const document = structuredClone(useXbarStore.getState().documents[0]);
  useXbarStore.setState({ currentRole: 'Viewer' });
  assert.equal(useXbarStore.getState().createHorseFromDocument(document.id).ok, false);
  assert.deepEqual(useXbarStore.getState().horses, []);
  assert.deepEqual(useXbarStore.getState().ownershipRecords, []);
  assert.deepEqual(useXbarStore.getState().documents, [document]);
});

test('grouped sources with equivalent microchip formatting still create one profile', async () => {
  const result = await intake([
    sourceFile('chip-one.txt', [
      'Registered Name: BLUE MOON',
      'Registration Number: 1234567',
      'Microchip: 985000000000001',
    ]),
    sourceFile('chip-two.txt', [
      'Registered Name: BLUE MOON',
      'Registration Number: 1234567',
      'Microchip: 985 000 000 000 001',
    ]),
  ]);
  assert.equal(result.createdHorseIds.length, 1);
  assert.equal(result.heldForReviewCount, 0);
  assert.equal(useXbarStore.getState().horses.length, 1);
  assert.equal(useXbarStore.getState().ownershipRecords.length, 1);
  assert.ok(useXbarStore.getState().documents.every((document) => document.horseId === result.createdHorseIds[0]));
});

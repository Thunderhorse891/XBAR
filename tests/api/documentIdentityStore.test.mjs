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
  assert.equal(horses[0].owner, 'Synthetic Ranch');
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

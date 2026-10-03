import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createEmptyWorkspaceState, createHorseRecord } from '../../src/store/xbarStoreHelpers.ts';
import { createOwnershipRecord, normalizeOwnershipRecord } from '../../src/store/xbarStoreLogic.ts';
import { ownershipDocumentReviewKey } from '../../src/lib/ownershipDocumentReview.ts';
import { useXbarStore } from '../../src/store/useXbarStore.ts';
await new Promise((resolve) => setImmediate(resolve));
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const empty = createEmptyWorkspaceState();
const horse = createHorseRecord(
  {
    name: 'DESERT DAISY',
    barnName: '',
    registrationNumber: '7001111',
    sex: 'Mare',
    segment: 'Sale Prospect',
    status: 'Sale Prep',
    owner: 'Synthetic',
    ownerEntity: '',
    barn: 'Test',
    pasture: '',
  },
  empty.workspaceProfile,
);
const record = createOwnershipRecord(horse);
const requirement = record.proofRequirements.find((proof) => proof.kind === 'registration_certificate');
const source = {
  id: 'source-a',
  horseId: horse.id,
  title: 'Source',
  type: 'Registration',
  state: 'Ready',
  localFileKey: 'synthetic-original',
  extractedTextPreview: 'CERTIFICATE OF REGISTRATION\nRegistered Name: DESERT DAISY\nRegistration Number: 7001111',
  entities: { horseName: horse.name, registrationNumber: horse.registrationNumber },
  duplicateRisk: 'Low',
};
const confirmation = (document) => ({ documentId: document.id, sourceKey: ownershipDocumentReviewKey(document) });
beforeEach(() =>
  useXbarStore.setState({
    ...empty,
    currentRole: 'Admin',
    horses: [horse],
    documents: [source],
    ownershipRecords: [record],
  }),
);

test('wrong type, unreviewed, unreadable and wrong horse cannot be linked as proof', () => {
  for (const patch of [
    { type: 'Vet Record' },
    { state: 'Needs Review' },
    { extractedTextPreview: '' },
    { horseId: 'other-horse' },
  ]) {
    useXbarStore.setState({ documents: [{ ...source, ...patch }] });
    assert.equal(useXbarStore.getState().linkOwnershipProof(record.id, requirement.id, source.id).ok, false);
    assert.equal(
      useXbarStore.getState().ownershipRecords[0].proofRequirements.find((proof) => proof.id === requirement.id).status,
      'missing',
    );
  }
});
test('linking never verifies; human review binds to exact source and replacement can be re-reviewed', () => {
  const store = () => useXbarStore.getState();
  assert.equal(store().linkOwnershipProof(record.id, requirement.id, source.id).ok, true);
  assert.equal(store().verifyOwnershipProof(record.id, requirement.id, 'Tester').ok, false);
  assert.equal(store().verifyOwnershipProof(record.id, requirement.id, 'Tester', confirmation(source)).ok, true);
  const replacement = { ...source, localFileKey: 'replacement-file' };
  useXbarStore.setState({ documents: [replacement] });
  const normalized = normalizeOwnershipRecord(store().ownershipRecords[0], [replacement]);
  assert.equal(normalized.proofRequirements.find((proof) => proof.id === requirement.id).status, 'linked');
  assert.equal(normalized.confidence, 0);
  assert.equal(
    store().verifyOwnershipProof(record.id, requirement.id, 'Tester', confirmation(source)).ok,
    false,
    'Old dialog cannot attest to replacement source',
  );
  assert.equal(store().verifyOwnershipProof(record.id, requirement.id, 'Tester', confirmation(replacement)).ok, true);
});
test('relink during open review refuses the original document confirmation', () => {
  const second = { ...source, id: 'source-b' };
  useXbarStore.setState({ documents: [source, second] });
  const store = () => useXbarStore.getState();
  store().linkOwnershipProof(record.id, requirement.id, source.id);
  store().linkOwnershipProof(record.id, requirement.id, second.id);
  assert.equal(store().verifyOwnershipProof(record.id, requirement.id, 'Tester', confirmation(source)).ok, false);
});
test('document approval refuses a contradictory identity and requires duplicate acknowledgment', () => {
  const store = () => useXbarStore.getState();
  useXbarStore.setState({ documents: [{ ...source, extractedTextPreview: 'Registered Name: OTHER HORSE' }] });
  assert.equal(store().reviewDocument(source.id, horse.id).ok, false);
  useXbarStore.setState({ documents: [{ ...source, duplicateRisk: 'Possible Duplicate' }] });
  assert.equal(store().reviewDocument(source.id, horse.id).ok, false);
  assert.equal(store().reviewDocument(source.id, horse.id, true).ok, true);
  assert.ok(store().documents[0].duplicateReviewedAt);
  assert.equal(store().documents.length, 1);
});

import { ownershipReviewSummary, buildServerSaleCredential } from '../../api/_lib/sale-credential.js';
test('server summary uses current reviewed source fingerprints and is sealed even when source is not selected', () => {
  const reviewed = {
    ...requirement,
    status: 'verified',
    documentId: source.id,
    verifiedBy: 'Tester',
    verifiedAt: '2026-10-02',
    reviewAttestedAt: '2026-10-02',
    reviewedSourceKey: ownershipDocumentReviewKey(source),
  };
  const ownershipRecord = { payload: { proofRequirements: [reviewed] } };
  const row = {
    document_id: source.id,
    horse_id: horse.id,
    document_type: source.type,
    state: 'Ready',
    payload: source,
  };
  assert.match(ownershipReviewSummary(ownershipRecord, [row]), /^1 of 1/);
  assert.match(
    ownershipReviewSummary(ownershipRecord, [{ ...row, payload: { ...source, localFileKey: 'replacement' } }]),
    /^0 of 1/,
  );
  assert.match(ownershipReviewSummary(ownershipRecord, [{ ...row, horse_id: 'different-horse' }]), /^0 of 1/);
  for (const patch of [
    { identityReviewRequired: true },
    { duplicateRisk: 'Possible Duplicate' },
    { processingNote: 'Incomplete source' },
  ]) {
    assert.match(ownershipReviewSummary(ownershipRecord, [{ ...row, payload: { ...source, ...patch } }]), /^0 of 1/);
  }
  const seal = buildServerSaleCredential({ context: {}, ownershipRecord, documents: [], reviewDocuments: [row] });
  assert.match(JSON.parse(seal.payload).transfer.reviewSummary, /^1 of 1/);
  assert.match(JSON.parse(seal.payload).transfer.reviewSummary, /does not independently verify/);
});

test('the customer ownership summary opens source review and never labels stale sources verified', async () => {
  const { readFile } = await import('node:fs/promises');
  const route = await readFile('src/routes/OwnershipChain.tsx', 'utf8');
  assert.match(route, /normalizeOwnershipRecord\([\s\S]*?record,[\s\S]*?documents,[\s\S]*?horses\.find/);
  assert.match(route, /`\/ownership\?horse=\$\{encodeURIComponent\(horseId\)\}`/);
  assert.match(route, /sources reviewed/);
  assert.doesNotMatch(route, /% verified|> Verified/);
});

test('approval re-reads sparse or stale legacy source identity instead of trusting copied entities', () => {
  const other = { ...horse, id: 'other-horse', name: 'OTHER HORSE', barnName: '' };
  useXbarStore.setState({ horses: [horse, other] });
  for (const entities of [{}, { horseName: other.name, registrationNumber: horse.registrationNumber }]) {
    const legacy = { ...source, horseId: undefined, entities };
    useXbarStore.setState({ documents: [legacy] });
    assert.equal(useXbarStore.getState().reviewDocument(source.id, other.id).ok, false);
    assert.deepEqual(useXbarStore.getState().documents[0], legacy);
  }
});

test('approval rejects contradictory readable pedigree and microchip even when cached entities are blank', () => {
  const target = {
    ...horse,
    microchipId: '982000123456789',
    bloodline: { ...horse.bloodline, sire: 'REAL SIRE (1234567)' },
  };
  useXbarStore.setState({ horses: [target] });
  for (const text of [
    'Horse: DESERT DAISY\nMicrochip: 982000987654321',
    'Horse: DESERT DAISY\nSire: OTHER SIRE',
    'Horse: DESERT DAISY\nSire: REAL SIRE\nSire Registration Number: 7654321',
  ]) {
    const legacy = { ...source, entities: {}, extractedTextPreview: text };
    useXbarStore.setState({ documents: [legacy] });
    assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, false, text);
  }
});

test('archived or queued originals cannot bypass review through direct approval or new-horse actions', () => {
  for (const state of ['Archived', 'Queued']) {
    const held = { ...source, state, horseId: undefined };
    useXbarStore.setState({ documents: [held] });
    assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, false);
    assert.equal(useXbarStore.getState().createHorseFromDocument(source.id).ok, false);
    assert.deepEqual(useXbarStore.getState().documents, [held]);
  }
});

test('the archived library remains read-only until server lifecycle enforcement is available', async () => {
  const { readFile } = await import('node:fs/promises');
  const library = await readFile('src/components/DocumentLibrary.tsx', 'utf8');
  const route = await readFile('src/routes/Documents.tsx', 'utf8');
  assert.match(library, /Restore and move controls aren’t available yet/);
  assert.doesNotMatch(library, /restoreDocument|reassignDocument|discardDocument|onControl/);
  const constants = await readFile('src/features/documents/constants.ts', 'utf8');
  const quickCreate = await readFile('src/components/saas/flows.tsx', 'utf8');
  assert.match(constants, /original files are uploaded to your workspace/);
  assert.match(route, /<p className="stack-item__copy">\{documentIntakeDisclosure\}<\/p>/);
  assert.match(quickCreate, /<p className="stack-item__copy">\{documentIntakeDisclosure\}<\/p>/);
  assert.match(route, /inspectDocumentHorseIdentity\(document, horse\)/);
  assert.match(route, /const reviewHorseId = document\.horseId \|\| requestedHorse\?\.id/);
});

test('microchip prose does not block document approval for a horse with a recorded chip', () => {
  const target = { ...horse, microchipId: '982000123456789' };
  useXbarStore.setState({ horses: [target] });
  for (const note of ['Microchip: UNKNOWN', 'Microchip scanned', 'Microchip: pending']) {
    const pending = {
      ...source,
      state: 'Needs Review',
      extractedTextPreview: `${source.extractedTextPreview}\n${note}`,
    };
    useXbarStore.setState({ documents: [pending] });
    assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true, note);
    assert.equal(useXbarStore.getState().documents[0].state, 'Ready', note);
    assert.equal(useXbarStore.getState().horses[0].microchipId, target.microchipId, note);
  }
});

test('pedigree placeholders allow approval without replacing known parents or filling blank parents', async () => {
  const { buildHorseEnrichmentFromEntities } = await import('../../src/store/xbarStoreLogic.ts');
  for (const value of ['UNKNOWN', 'N/A', 'Not recorded', 'Pending']) {
    const target = { ...horse, bloodline: { ...horse.bloodline, sire: 'SHINING SPARK', dam: 'BLUE GIRL' } };
    const pending = {
      ...source,
      state: 'Needs Review',
      extractedTextPreview: `${source.extractedTextPreview}\nSire: ${value}\nDam: ${value}`,
      entities: { ...source.entities, sire: value, dam: value },
    };
    useXbarStore.setState({ horses: [target], documents: [pending] });
    assert.equal(useXbarStore.getState().reviewDocument(source.id, target.id).ok, true, value);
    assert.deepEqual(useXbarStore.getState().horses[0].bloodline, target.bloodline);
    const blank = { ...target, bloodline: { ...target.bloodline, sire: '', dam: '' } };
    assert.deepEqual(buildHorseEnrichmentFromEntities(pending.entities, blank).patch, {}, value);
  }
});

test('approval rejects all conflicting chip list identities and preserves the pending source', () => {
  const target = { ...horse, microchipId: '900123456789012' };
  for (const separator of [', ', '/', ' and ', ' or ', '; ', ' & ']) {
    const pending = {
      ...source,
      state: 'Needs Review',
      extractedTextPreview: `${source.extractedTextPreview}\nMicrochip: 900123456789012${separator}900123456789099`,
    };
    useXbarStore.setState({ horses: [target], documents: [pending] });
    assert.equal(useXbarStore.getState().reviewDocument(source.id, target.id).ok, false, separator);
    assert.equal(useXbarStore.getState().documents[0].state, 'Needs Review', separator);
    assert.equal(useXbarStore.getState().horses[0].microchipId, target.microchipId, separator);
  }
});

test('approval refuses cached facts with missing source identity without calling it a contradiction', () => {
  for (const entities of [source.entities, { color: 'Bay', ownerName: 'Unsupported Owner' }]) {
    const pending = { ...source, state: 'Needs Review', extractedTextPreview: 'CERTIFICATE OF REGISTRATION', entities };
    useXbarStore.setState({ documents: [pending] });
    const before = structuredClone({
      horses: useXbarStore.getState().horses,
      ownershipRecords: useXbarStore.getState().ownershipRecords,
    });
    const result = useXbarStore.getState().reviewDocument(pending.id, horse.id);
    assert.equal(result.ok, false);
    assert.match(result.message, /no .*identity|identity.*not.*read|identity.*missing/i);
    assert.doesNotMatch(result.message, /conflict|contradict/i);
    assert.deepEqual(useXbarStore.getState().documents, [pending]);
    assert.deepEqual(useXbarStore.getState().horses, before.horses);
    assert.deepEqual(useXbarStore.getState().ownershipRecords, before.ownershipRecords);
  }
});

test('identity-free manual attachment without cached facts does not promote facts or readiness', () => {
  const pending = {
    ...source,
    horseId: undefined,
    type: 'Transfer Packet',
    state: 'Needs Review',
    extractedTextPreview: 'Care notes for manual review.',
    entities: {},
  };
  useXbarStore.setState({ documents: [pending] });
  const result = useXbarStore.getState().reviewDocument(pending.id, horse.id);
  assert.equal(result.ok, true);
  assert.equal(useXbarStore.getState().documents[0].horseId, horse.id);
  assert.deepEqual(useXbarStore.getState().horses[0], { ...horse, documents: [...horse.documents, source.id] });
  assert.deepEqual(useXbarStore.getState().ownershipRecords, [record]);
  assert.equal(useXbarStore.getState().linkOwnershipProof(record.id, requirement.id, pending.id).ok, false);
});

test('approval uses source-read facts and supports source-only registration or chip identity', () => {
  const target = { ...horse, microchipId: '982000123456789' };
  for (const text of [
    source.extractedTextPreview,
    'CERTIFICATE OF REGISTRATION\nRegistration Number: 7001111',
    'Microchip: 982000123456789',
  ]) {
    const pending = {
      ...source,
      state: 'Needs Review',
      extractedTextPreview: text,
      entities: { ...source.entities, color: 'Bay', ownerName: 'Unsupported Owner' },
    };
    useXbarStore.setState({ horses: [target], documents: [pending] });
    assert.equal(useXbarStore.getState().reviewDocument(pending.id, target.id).ok, true, text);
    const facts = useXbarStore.getState().horses[0].documentFacts;
    assert.equal(
      facts.some((fact) => ['color', 'ownerName'].includes(fact.label)),
      false,
      text,
    );
    assert.equal(
      facts.some((fact) => fact.label === 'horseName'),
      text.includes('Registered Name:'),
      text,
    );
  }
});

test('Apply facts executes its source identity gate and applies only source-read facts', async () => {
  const { readFile } = await import('node:fs/promises');
  const ts = await import('typescript');
  const { runInNewContext } = await import('node:vm');
  const { inspectDocumentHorseIdentity } = await import('../../src/lib/ownershipDocumentReview.ts');
  const { buildHorseEnrichmentFromEntities } = await import('../../src/store/xbarStoreLogic.ts');
  const route = await readFile('src/routes/Documents.tsx', 'utf8');
  const handler = route.slice(
    route.indexOf('  const applyExtractedFacts ='),
    route.indexOf('  const createHorseFromReview ='),
  );
  assert.ok(handler.includes('const applyExtractedFacts ='));
  const executable = ts.transpileModule(`${handler}\napplyExtractedFacts`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [text, expectedColor] of [
    ['CERTIFICATE OF REGISTRATION', undefined],
    [source.extractedTextPreview, undefined],
    [`${source.extractedTextPreview}\nColor: Black`, 'Black'],
    ['Registration Number: 7001111\nColor: Black', 'Black'],
    ['Microchip: 982000123456789\nColor: Black', 'Black'],
  ]) {
    const target = { ...horse, owner: '', color: '', microchipId: '982000123456789' };
    const updates = [];
    const toasts = [];
    const apply = runInNewContext(executable, {
      horses: [target],
      reviewAssignments: {},
      inspectDocumentHorseIdentity,
      buildHorseEnrichmentFromEntities,
      updateHorse: (id, patch) => {
        updates.push({ id, patch });
        return { ok: true };
      },
      pushToast: (toast) => toasts.push(toast),
      recordAuditEvent: () => {},
      currentUserName: 'Tester',
    });
    apply({
      ...source,
      extractedTextPreview: text,
      entities: {
        horseName: 'OLD WRONG CACHE',
        registrationNumber: '9999999',
        color: 'Bay',
        ownerName: 'Unsupported Owner',
      },
      identityReviewRequired: true,
    });
    assert.equal(updates.length, expectedColor ? 1 : 0, text);
    if (expectedColor) assert.deepEqual(updates[0], { id: target.id, patch: { color: expectedColor } });
    else assert.equal(toasts.length, 1);
  }
});

test('approval preserves freshly read clinical and transfer facts but ignores cached or filename-only facts', () => {
  for (const [type, text, expected] of [
    [
      'Vet Record',
      'Exam Date: 2026-10-02\nVeterinarian: Dr Avery Smith',
      { examDate: '2026-10-02', veterinarian: 'Dr Avery Smith' },
    ],
    [
      'Coggins',
      'Exam Date: 2026-10-03\nVeterinarian: Dr Avery Smith',
      { examDate: '2026-10-03', veterinarian: 'Dr Avery Smith' },
    ],
    ['Vet Record', 'Clinical notes only.', {}],
    ['Transfer Packet', 'TRANSFER OF OWNERSHIP\nStatus: AQHA review', { transferStatus: 'AQHA Review' }],
  ]) {
    const pending = {
      ...source,
      title: '2030-01-01 Dr Filename Name',
      state: 'Needs Review',
      type,
      extractedTextPreview: `${text}\nRegistered Name: DESERT DAISY`,
      entities: {
        ...source.entities,
        examDate: '2031-01-01',
        veterinarian: 'Dr Cached Name',
        transferStatus: 'Clear',
        color: 'Bay',
        ownerName: 'Unsupported Owner',
      },
    };
    useXbarStore.setState({ horses: [horse], documents: [pending] });
    assert.equal(useXbarStore.getState().reviewDocument(pending.id, horse.id).ok, true, text);
    const facts = Object.fromEntries(
      useXbarStore.getState().horses[0].documentFacts.map((fact) => [fact.label, fact.value]),
    );
    for (const key of ['examDate', 'veterinarian', 'transferStatus', 'color', 'ownerName']) {
      assert.equal(facts[key], expected[key], `${type}: ${key}`);
      assert.equal(useXbarStore.getState().documents[0].entities[key], expected[key], `${type}: persisted ${key}`);
    }
  }
});

test('approval and proof linking use clear source despite obsolete identity cache and flag', () => {
  const pending = {
    ...source,
    state: 'Needs Review',
    identityReviewRequired: true,
    entities: { horseName: 'OLD WRONG CACHE', registrationNumber: '9999999', ownerName: 'Unsupported Owner' },
  };
  useXbarStore.setState({ documents: [pending] });
  assert.equal(useXbarStore.getState().reviewDocument(pending.id, horse.id).ok, true);
  const approved = useXbarStore.getState().documents[0];
  assert.equal(approved.identityReviewRequired, false);
  assert.equal(approved.entities.horseName, horse.name);
  const repairAudit = useXbarStore
    .getState()
    .auditEvents.find((event) => event.entityType === 'document' && event.entityId === source.id);
  assert.deepEqual(JSON.parse(repairAudit.context.previousEntities), pending.entities);
  const facts = Object.fromEntries(
    useXbarStore.getState().horses[0].documentFacts.map((fact) => [fact.label, fact.value]),
  );
  assert.equal(facts.horseName, horse.name);
  assert.equal(facts.registrationNumber, horse.registrationNumber);
  assert.equal(facts.ownerName, undefined);
  assert.equal(useXbarStore.getState().linkOwnershipProof(record.id, requirement.id, approved.id).ok, true);
});

test('a stale operational identity flag requires document reapproval before truthful human ownership verification', () => {
  const legacy = {
    ...source,
    identityReviewRequired: true,
    entities: { horseName: 'OLD WRONG CACHE', registrationNumber: '9999999' },
  };
  const linked = {
    ...record,
    proofRequirements: record.proofRequirements.map((item) =>
      item.id === requirement.id ? { ...item, status: 'linked', documentId: source.id } : item,
    ),
  };
  useXbarStore.setState({ documents: [legacy], ownershipRecords: [linked] });
  const denied = useXbarStore
    .getState()
    .verifyOwnershipProof(record.id, requirement.id, 'Tester', confirmation(legacy));
  assert.equal(denied.ok, false);
  assert.match(denied.message, /approve.*document|document.*approv/i);
  assert.deepEqual(useXbarStore.getState().ownershipRecords, [linked]);
  assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true);
  assert.equal(useXbarStore.getState().documents[0].identityReviewRequired, false);
  assert.equal(useXbarStore.getState().verifyOwnershipProof(record.id, requirement.id, 'Tester').ok, false);
  assert.equal(
    normalizeOwnershipRecord(useXbarStore.getState().ownershipRecords[0], useXbarStore.getState().documents, horse)
      .confidence,
    0,
  );
  assert.equal(
    useXbarStore
      .getState()
      .verifyOwnershipProof(record.id, requirement.id, 'Tester', confirmation(useXbarStore.getState().documents[0])).ok,
    true,
  );
  const normalized = normalizeOwnershipRecord(
    useXbarStore.getState().ownershipRecords[0],
    useXbarStore.getState().documents,
    horse,
  );
  assert.equal(normalized.proofRequirements.find((item) => item.id === requirement.id).status, 'verified');
});

test('Documents presents fresh source names and facts while keeping flagged approvals in review', async () => {
  const { readFile } = await import('node:fs/promises');
  const ts = await import('typescript');
  const { runInNewContext } = await import('node:vm');
  const { documentWithFreshSource, documentIdentityCacheNeedsReview } =
    await import('../../src/lib/ownershipDocumentReview.ts');
  const route = await readFile('src/routes/Documents.tsx', 'utf8');
  const sourceView = route.slice(
    route.indexOf('  const documents = useMemo('),
    route.indexOf('  const intakeBatches ='),
  );
  assert.ok(sourceView.includes('documentWithFreshSource'));
  const legacy = {
    ...source,
    identityReviewRequired: true,
    entities: { horseName: 'OLD WRONG CACHE', registrationNumber: '9999999', ownerName: 'Unsupported Owner' },
  };
  const executable = ts.transpileModule(`${sourceView}\ndocuments`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const documents = runInNewContext(executable, {
    storedDocuments: [legacy, { ...legacy, id: 'cache-only-source', identityReviewRequired: false }],
    horses: [horse],
    documentWithFreshSource,
    documentIdentityCacheNeedsReview,
    useMemo: (read) => read(),
  });
  assert.equal(documents[0].entities.horseName, horse.name);
  assert.equal(documents[0].entities.registrationNumber, horse.registrationNumber);
  assert.equal(documents[0].entities.ownerName, undefined);
  assert.equal(documents[0].identityReviewRequired, false);
  assert.equal(documents[0].state, 'Needs Review');
  assert.equal(documents[1].state, 'Needs Review', 'A cache-only discrepancy also has an explicit repair path');
  assert.equal(legacy.entities.horseName, 'OLD WRONG CACHE');
  assert.equal(legacy.identityReviewRequired, true);
  assert.match(
    route,
    /normalizeOwnershipRecord\(record, storedDocuments, horse\)/,
    'The proof display retains conservative operational normalization',
  );
});

test('explicit source-clear reapproval removes only the generated identity warning and renews ownership attestation', () => {
  const staleWarning =
    'Conflicting horse identities were read from this file. Upload separate papers for each horse before approving.';
  const coverage = 'Only 3 of 10 pages were read.';
  const mixedType = 'Multiple document types were read. Upload separate sources for each requirement.';
  for (const remaining of ['', `${coverage} ${mixedType}`]) {
    const legacy = {
      ...source,
      identityReviewRequired: true,
      processingNote: `${staleWarning}${remaining ? ` ${remaining}` : ''}`,
    };
    const reviewed = {
      ...record,
      proofRequirements: record.proofRequirements.map((item) =>
        item.id === requirement.id
          ? {
              ...item,
              status: 'verified',
              documentId: source.id,
              verifiedAt: '2026-10-01',
              verifiedBy: 'Earlier reviewer',
              reviewAttestedAt: '2026-10-01',
              reviewedSourceKey: ownershipDocumentReviewKey(legacy),
            }
          : item,
      ),
    };
    useXbarStore.setState({ documents: [legacy], ownershipRecords: [reviewed] });
    assert.equal(
      normalizeOwnershipRecord(reviewed, [legacy], horse).proofRequirements.find((item) => item.id === requirement.id)
        .status,
      'linked',
    );
    assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true);
    const approved = useXbarStore.getState().documents[0];
    assert.equal(approved.processingNote, remaining);
    assert.equal(approved.identityReviewRequired, false);
    const proof = useXbarStore
      .getState()
      .ownershipRecords[0].proofRequirements.find((item) => item.id === requirement.id);
    assert.equal(proof.status, 'linked', 'Metadata repair must not revive an old ownership attestation');
    assert.equal(proof.reviewAttestedAt, undefined);
    assert.equal(proof.reviewedSourceKey, undefined);
    assert.equal(useXbarStore.getState().verifyOwnershipProof(record.id, requirement.id, 'Tester').ok, false);
    assert.equal(
      useXbarStore.getState().verifyOwnershipProof(record.id, requirement.id, 'Tester', confirmation(approved)).ok,
      !remaining,
      'Coverage and mixed-type warnings still block ownership review',
    );
  }
  const missing = {
    ...source,
    state: 'Needs Review',
    identityReviewRequired: true,
    entities: {},
    extractedTextPreview: '',
    processingNote: staleWarning,
  };
  useXbarStore.setState({ documents: [missing] });
  assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true);
  assert.equal(
    useXbarStore.getState().documents[0].processingNote,
    staleWarning,
    'Manual attachment without readable identity must not erase the warning',
  );
});

test('explicit identity repair preserves unrelated proofs, declared ownership and audit history; ordinary approvals retain attestations', () => {
  const reviewedProof = {
    ...requirement,
    status: 'verified',
    documentId: source.id,
    verifiedAt: '2026-10-01',
    verifiedBy: 'Tester',
    reviewAttestedAt: '2026-10-01',
    reviewedSourceKey: ownershipDocumentReviewKey(source),
  };
  const unrelatedProof = {
    ...record.proofRequirements.find((item) => item.id !== requirement.id),
    documentId: 'unrelated-source',
    status: 'verified',
    verifiedAt: '2026-10-01',
    verifiedBy: 'Other reviewer',
    reviewAttestedAt: '2026-10-01',
    reviewedSourceKey: 'unrelated-source-key',
  };
  const reviewed = {
    ...record,
    legalOwner: 'Declared Owner',
    auditTrail: ['Prior history'],
    proofRequirements: [reviewedProof, unrelatedProof],
  };
  const unrelatedRecord = {
    ...record,
    id: 'unrelated-record',
    horseId: 'unrelated-horse',
    confidence: 37,
    proofRequirements: [unrelatedProof],
  };
  useXbarStore.setState({
    documents: [{ ...source, identityReviewRequired: true }],
    ownershipRecords: [reviewed, unrelatedRecord],
  });
  assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true);
  const repaired = useXbarStore.getState().ownershipRecords[0];
  assert.equal(repaired.legalOwner, reviewed.legalOwner);
  assert.deepEqual(repaired.auditTrail, reviewed.auditTrail);
  assert.deepEqual(repaired.proofRequirements[1], unrelatedProof);
  assert.equal(repaired.proofRequirements[0].documentId, source.id);
  assert.equal(repaired.proofRequirements[0].status, 'linked');
  assert.deepEqual(useXbarStore.getState().ownershipRecords[1], unrelatedRecord);
  assert.equal(
    useXbarStore
      .getState()
      .verifyOwnershipProof(record.id, requirement.id, 'Tester', confirmation(useXbarStore.getState().documents[0])).ok,
    true,
  );
  const verifiedAgain = structuredClone(useXbarStore.getState().ownershipRecords);
  assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true);
  assert.deepEqual(
    useXbarStore.getState().ownershipRecords,
    verifiedAgain,
    'An ordinary unchanged approval does not invalidate ownership review',
  );
});

for (const priorStatus of ['verified', 'linked']) {
  test(`cache-only identity repair holds ${priorStatus} proof until explicit reapproval and renewed human review`, () => {
    const legacy = {
      ...source,
      identityReviewRequired: false,
      processingNote: '',
      entities: { horseName: 'OLD WRONG CACHE', registrationNumber: '9999999', ownerName: 'OLD OWNER' },
    };
    const oldProof = {
      ...requirement,
      status: priorStatus,
      documentId: source.id,
      verifiedAt: '2026-10-01',
      verifiedBy: 'Prior reviewer',
      reviewAttestedAt: '2026-10-01',
      reviewedSourceKey: ownershipDocumentReviewKey(legacy),
    };
    const oldRecord = {
      ...record,
      legalOwner: 'Declared Owner',
      auditTrail: ['Keep prior history'],
      proofRequirements: record.proofRequirements.map((item) => (item.id === requirement.id ? oldProof : item)),
    };
    useXbarStore.setState({ documents: [legacy], ownershipRecords: [oldRecord] });
    const before = structuredClone({
      documents: useXbarStore.getState().documents,
      ownershipRecords: useXbarStore.getState().ownershipRecords,
    });
    const normalized = normalizeOwnershipRecord(oldRecord, [legacy], horse);
    assert.equal(normalized.proofRequirements.find((item) => item.id === requirement.id).status, 'linked');
    assert.equal(normalized.confidence, 0);
    assert.deepEqual(
      useXbarStore.getState().documents,
      before.documents,
      'Read-only normalization does not repair stored evidence',
    );
    assert.deepEqual(useXbarStore.getState().ownershipRecords, before.ownershipRecords);
    const denied = useXbarStore
      .getState()
      .verifyOwnershipProof(record.id, requirement.id, 'Tester', confirmation(legacy));
    assert.equal(denied.ok, false);
    assert.match(denied.message, /approve.*document|document.*approv/i);
    assert.deepEqual(useXbarStore.getState().ownershipRecords, before.ownershipRecords);
    assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true);
    const approved = useXbarStore.getState().documents[0];
    assert.equal(approved.entities.horseName, horse.name);
    assert.equal(approved.entities.registrationNumber, horse.registrationNumber);
    assert.equal(approved.entities.ownerName, undefined);
    const audit = useXbarStore
      .getState()
      .auditEvents.find((event) => event.entityType === 'document' && event.entityId === source.id);
    assert.ok(audit);
    assert.deepEqual(JSON.parse(audit.context.previousEntities), legacy.entities);
    const repairedRecord = useXbarStore.getState().ownershipRecords[0];
    const repairedProof = repairedRecord.proofRequirements.find((item) => item.id === requirement.id);
    assert.equal(repairedProof.status, 'linked');
    assert.equal(repairedProof.reviewAttestedAt, undefined);
    assert.equal(repairedProof.reviewedSourceKey, undefined);
    assert.equal(repairedProof.documentId, source.id);
    assert.equal(repairedRecord.legalOwner, oldRecord.legalOwner);
    assert.deepEqual(repairedRecord.auditTrail, oldRecord.auditTrail);
    assert.deepEqual(
      repairedRecord.proofRequirements.filter((item) => item.id !== requirement.id),
      oldRecord.proofRequirements.filter((item) => item.id !== requirement.id),
    );
    assert.equal(useXbarStore.getState().verifyOwnershipProof(record.id, requirement.id, 'Tester').ok, false);
    assert.equal(
      useXbarStore.getState().verifyOwnershipProof(record.id, requirement.id, 'Tester', confirmation(approved)).ok,
      true,
    );
    const reverified = normalizeOwnershipRecord(useXbarStore.getState().ownershipRecords[0], [approved], horse);
    assert.equal(reverified.proofRequirements.find((item) => item.id === requirement.id).status, 'verified');
    const auditAfterRepair = structuredClone(useXbarStore.getState().auditEvents);
    const proofAfterRepair = structuredClone(useXbarStore.getState().ownershipRecords);
    assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true);
    assert.deepEqual(
      useXbarStore.getState().auditEvents,
      auditAfterRepair,
      'A repeated ordinary approval does not repeat the repair audit',
    );
    assert.deepEqual(
      useXbarStore.getState().ownershipRecords,
      proofAfterRepair,
      'Renewed valid attestations stay verified',
    );
  });
}

test('source-clear approval removes unsupported matching-identity cache from buyer view and trust scoring', async () => {
  const { sanitizeDocumentForBuyerView } = await import('../../src/lib/publicShare.ts');
  const { buildDocumentTrustProfile } = await import('../../src/lib/xbarPhaseTwo.ts');
  const pending = {
    ...source,
    state: 'Needs Review',
    confidence: 0.91,
    entities: {
      ...source.entities,
      ownerName: 'Unsupported Owner',
      color: 'Bay',
      sire: 'CACHED STALLION',
      dam: 'CACHED MARE',
    },
  };
  const oldProof = {
    ...requirement,
    status: 'verified',
    documentId: source.id,
    verifiedAt: '2026-10-01',
    verifiedBy: 'Prior reviewer',
    reviewAttestedAt: '2026-10-01',
    reviewedSourceKey: ownershipDocumentReviewKey(pending),
  };
  const reviewed = {
    ...record,
    legalOwner: 'Declared Owner',
    proofRequirements: record.proofRequirements.map((item) => (item.id === requirement.id ? oldProof : item)),
  };
  const originalHistory = {
    id: 'prior-audit',
    actor: 'Tester',
    action: 'created',
    entityType: 'document',
    entityId: source.id,
    at: '2026-10-01',
    summary: 'Existing history',
  };
  useXbarStore.setState({ documents: [pending], ownershipRecords: [reviewed], auditEvents: [originalHistory] });
  const inflatedTrust = buildDocumentTrustProfile({ ...pending, state: 'Ready' }, [horse]);
  assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true);
  const approved = useXbarStore.getState().documents[0];
  const buyerDocument = sanitizeDocumentForBuyerView(approved);
  for (const key of ['ownerName', 'color', 'sire', 'dam']) {
    assert.equal(buyerDocument.entities[key], undefined, `${key} must not reach buyers`);
    assert.equal(approved.entities[key], undefined, `${key} must not remain in approved operational cache`);
  }
  assert.equal(buyerDocument.entities.horseName, horse.name);
  assert.equal(buyerDocument.entities.registrationNumber, horse.registrationNumber);
  const trust = buildDocumentTrustProfile(approved, [horse]);
  const sourceOnlyTrust = buildDocumentTrustProfile({ ...approved, entities: source.entities }, [horse]);
  assert.equal(trust.entityCount, 2);
  assert.equal(trust.trustScore, sourceOnlyTrust.trustScore);
  assert.ok(trust.trustScore < inflatedTrust.trustScore, 'Cached factual padding must not increase approved trust');
  const audits = useXbarStore.getState().auditEvents;
  assert.equal(audits.length, 2);
  assert.deepEqual(audits[1], originalHistory);
  assert.deepEqual(JSON.parse(audits[0].context.previousEntities), pending.entities);
  assert.deepEqual(JSON.parse(audits[0].context.sourceEntities), source.entities);
  const repaired = useXbarStore.getState().ownershipRecords[0];
  assert.equal(repaired.legalOwner, reviewed.legalOwner);
  assert.equal(repaired.proofRequirements.find((item) => item.id === requirement.id).status, 'linked');
  assert.equal(repaired.proofRequirements.find((item) => item.id === requirement.id).reviewedSourceKey, undefined);
  assert.equal(useXbarStore.getState().verifyOwnershipProof(record.id, requirement.id, 'Tester').ok, false);
  assert.equal(
    useXbarStore.getState().verifyOwnershipProof(record.id, requirement.id, 'Tester', confirmation(approved)).ok,
    true,
  );
  const after = structuredClone({
    auditEvents: useXbarStore.getState().auditEvents,
    ownershipRecords: useXbarStore.getState().ownershipRecords,
  });
  assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true);
  assert.deepEqual(useXbarStore.getState().auditEvents, after.auditEvents, 'No repeated cache-change audit');
  assert.deepEqual(
    useXbarStore.getState().ownershipRecords,
    after.ownershipRecords,
    'Ordinary repeat does not invalidate the renewed attestation',
  );
});

test('source-clear approval refreshes newly supported facts, ignores entity key order and preserves manual empty attachments', () => {
  const pending = {
    ...source,
    state: 'Needs Review',
    extractedTextPreview: `${source.extractedTextPreview}\nOwner: Fresh Ranch\nColor: Black`,
    entities: {
      registrationNumber: horse.registrationNumber,
      horseName: horse.name,
      ownerName: 'Stale Ranch',
      color: 'Bay',
    },
  };
  useXbarStore.setState({ documents: [pending] });
  assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true);
  const approved = useXbarStore.getState().documents[0];
  assert.equal(approved.entities.ownerName, 'Fresh Ranch');
  assert.equal(approved.entities.color, 'Black');
  const auditCount = useXbarStore.getState().auditEvents.length;
  const reordered = { ...approved, entities: Object.fromEntries(Object.entries(approved.entities).reverse()) };
  useXbarStore.setState({ documents: [reordered] });
  assert.equal(useXbarStore.getState().reviewDocument(source.id, horse.id).ok, true);
  assert.equal(useXbarStore.getState().auditEvents.length, auditCount);
  const manual = {
    ...source,
    id: 'manual-empty',
    horseId: undefined,
    state: 'Needs Review',
    extractedTextPreview: 'Care notes without identity.',
    entities: {},
  };
  useXbarStore.setState({ documents: [manual] });
  assert.equal(useXbarStore.getState().reviewDocument(manual.id, horse.id).ok, true);
  assert.deepEqual(useXbarStore.getState().documents[0].entities, {});
  assert.equal(useXbarStore.getState().auditEvents.length, auditCount);
});

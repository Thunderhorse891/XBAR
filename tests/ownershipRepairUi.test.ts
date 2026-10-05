import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { DocumentRecord, OwnershipRecord } from '../src/types/xbar.js';
import type { OwnershipDocumentReview } from '../src/lib/ownershipDocumentReview.js';

const sourceText = readFileSync('src/routes/Ownership.tsx', 'utf8');
const source = ts.createSourceFile('Ownership.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Execute the route's pure decisions without importing its browser-only stores
// or styles. Wiring assertions below pin the decisions to the rendered route.
function routeDecision<T>(name: string): T {
  const declaration = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(declaration, `${name} must be defined in the ownership route`);
  const javascript = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(`${javascript}\nreturn ${name};`)() as T;
}

test('a requested horse without an ownership record never selects another horse', () => {
  const initial = routeDecision<(records: OwnershipRecord[], horseId: string) => string>('initialOwnershipRecordId');
  const a = { id: 'record-a', horseId: 'horse-a' } as OwnershipRecord;
  const b = { id: 'record-b', horseId: 'horse-b' } as OwnershipRecord;
  assert.equal(initial([a], 'horse-b'), '');
  assert.equal(initial([], 'horse-b'), '');
  assert.equal(initial([a, b], 'horse-b'), 'record-b');
  assert.equal(initial([a], ''), 'record-a');
  assert.match(sourceText, /useState\(\s*initialOwnershipRecordId\(records, requestedHorseId\)/);
  assert.match(sourceText, /const selectedRecord = records\.find\(\(record\) => record\.id === selectedRecordId\);/);
  assert.match(sourceText, /if \(requestedHorseId\) setSelectedRecordId\(requestedRecordId \?\? ''\)/);
  assert.match(sourceText, /Start ownership record/);
  assert.match(sourceText, /ensureOwnershipRecord\(requestedHorse\.id\)/);
});

test('ineligible approved originals route to replacement upload, not back to Proof', () => {
  type Assessment = { document: DocumentRecord; review: OwnershipDocumentReview };
  const usable = routeDecision<(assessments: Assessment[]) => DocumentRecord[]>('ownershipRepairDocuments');
  const ready = { id: 'bad', type: 'Registration', state: 'Ready', localFileKey: 'original' } as DocumentRecord;
  const review = (status: OwnershipDocumentReview['status'], ok = false): OwnershipDocumentReview => ({
    ok,
    status,
    message: status,
  });
  for (const status of ['wrong_type', 'identity_mismatch', 'missing_identity', 'unreadable', 'missing'] as const) {
    assert.deepEqual(usable([{ document: ready, review: review(status) }]), [], status);
  }
  const partial = { ...ready, state: 'Needs Review' as const, processingNote: 'Only page 1 was read.' };
  assert.deepEqual(usable([{ document: partial, review: review('review_needed') }]), []);
  const pending = { ...ready, state: 'Needs Review' as const };
  assert.deepEqual(usable([{ document: pending, review: review('review_needed') }]), [pending]);
  const queued = { ...ready, state: 'Queued' as const };
  assert.deepEqual(usable([{ document: queued, review: review('unreadable') }]), [queued]);
  assert.deepEqual(usable([{ document: ready, review: review('review_needed', true) }]), [ready]);
  assert.match(
    sourceText,
    /packetDocumentAction\(\s*selectedRecord\?\.horseId \?\? '',\s*ownershipRepairDocuments\(assessments\)/,
  );
});

test('profile facts preserve one-way legacy links but exclude archived and other-horse sources', () => {
  const profileText = readFileSync('src/routes/AnimalProfile.tsx', 'utf8');
  const profile = ts.createSourceFile(
    'AnimalProfile.tsx',
    profileText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(profile) === 'activeDocumentFacts')
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(profile);
  assert.ok(initializer, 'Profile must derive its visible document facts');
  const javascript = ts.transpileModule(`const actual = ${initializer.getText(profile)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const visible = new Function('animal', 'documents', `${javascript}\nreturn actual;`);
  const facts = ['direct', 'legacy', 'archived', 'foreign', 'unlinked', 'missing'].map((id) => ({
    id,
    sourceDocumentId: id,
  }));
  const animal = { id: 'horse-a', documents: ['legacy', 'archived', 'foreign'], documentFacts: facts };
  const documents = [
    { id: 'direct', horseId: 'horse-a', state: 'Ready' },
    { id: 'legacy', state: 'Ready' },
    { id: 'archived', state: 'Archived' },
    { id: 'foreign', horseId: 'horse-b', state: 'Ready' },
    { id: 'unlinked', state: 'Ready' },
  ];
  assert.deepEqual(
    visible(animal, documents).map((fact: { id: string }) => fact.id),
    ['direct', 'legacy'],
  );
  documents[1].state = 'Archived';
  assert.deepEqual(
    visible(animal, documents).map((fact: { id: string }) => fact.id),
    ['direct'],
  );
});

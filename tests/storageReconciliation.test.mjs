import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileStorageFixture } from '../scripts/qa/reconcile-storage-fixture.mjs';

const ref = (source, path, workspace = 'w1', bucket = 'horse-documents') => ({
  source,
  path,
  workspace,
  bucket,
});
const object = (path, bytes, bucket = 'horse-documents') => ({ path, bytes, bucket });
const run = (references, objects, completeBuckets = ['horse-documents']) =>
  reconcileStorageFixture({ mode: 'synthetic', references, objects, completeBuckets });

test('dedupes ordinary reference aliases by bucket and path, using provider bytes', () => {
  const result = run(
    [
      { ...ref('document', '/w1/one.pdf'), declaredBytes: 1 },
      { ...ref('expense-receipt', 'w1/one.pdf'), declaredBytes: 2 },
      ref('packet', 'w1/one.pdf', 'w1', 'sale-packets'),
      ref('horse-media', 'w1/one.pdf', 'w1', 'horse-media'),
    ],
    [
      object('w1/one.pdf', 140),
      object('w1/one.pdf', 140),
      object('w1/one.pdf', 30, 'sale-packets'),
      object('w1/one.pdf', 300, 'horse-media'),
    ],
  );
  assert.deepEqual(result.totals, { knownBytes: 470, referencedBytes: 470, orphanBytes: 0 });
  assert.deepEqual(result.workspaceKnownBytes, [{ workspace: 'w1', bytes: 470 }]);
  assert.deepEqual(result.entries[0].sources, ['document', 'expense-receipt']);
  assert.equal(result.entries.length, 3);
});

test('distinguishes missing, unobserved, unknown size, and orphans including zero bytes', () => {
  const result = run(
    [
      ref('document', 'w1/missing.pdf'),
      ref('horse-media', 'w1/unobserved.jpg', 'w1', 'horse-media'),
      ref('document', 'w1/no-size.pdf'),
    ],
    [object('w1/no-size.pdf', null), object('w1/orphan.pdf', 20), object('w1/zero.pdf', 0)],
  );
  const keyed = Object.fromEntries(result.entries.map((entry) => [entry.path, entry]));
  assert.equal(keyed['w1/missing.pdf'].state, 'missing');
  assert.equal(keyed['w1/unobserved.jpg'].state, 'unobserved');
  assert.equal(keyed['w1/no-size.pdf'].state, 'unknown-size');
  assert.deepEqual([keyed['w1/orphan.pdf'].link, keyed['w1/orphan.pdf'].bytes], ['orphan', 20]);
  assert.deepEqual([keyed['w1/zero.pdf'].state, keyed['w1/zero.pdf'].bytes], ['measured', 0]);
  assert.equal(result.totals.orphanBytes, 20);
});

test('does not attribute conflicting workspace references or invent a conflicting length', () => {
  const result = run(
    [ref('document', 'same'), ref('expense-receipt', 'same', 'w2'), ref('document', 'size')],
    [object('same', 12), object('size', 10), object('size', 20)],
  );
  assert.deepEqual(result.entries[0].workspaces, ['w1', 'w2']);
  assert.deepEqual(result.workspaceKnownBytes, []);
  assert.equal(result.entries[1].state, 'unknown-size');
  assert.equal(result.entries[1].sizeConflict, true);
  assert.equal(result.totals.knownBytes, 12);
});

test('rejects ambiguous object paths and does not URL-decode legitimate storage keys', () => {
  for (const path of ['//w1/f', 'w1//f', '/w1/../f', 'https://x.test/f', 'w1\\f']) {
    assert.throws(() => run([ref('document', path)], []), /path/i);
  }
  assert.throws(() => run([], [object('/w1/f', 1)]), /path/i);
  const result = run([], [object('w1/f%20a', 2), object('w1/f a', 3)]);
  assert.equal(result.entries.length, 2);
  assert.equal(result.totals.knownBytes, 5);
});

test('rejects unauthorized fixture modes and invalid byte metadata', () => {
  assert.throws(() => reconcileStorageFixture({ mode: 'live' }), /synthetic/i);
  for (const bytes of [-1, 1.2, '3', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => run([], [object('w1/f', bytes)]), /bytes/i);
  }
  assert.throws(() => run([], [object('w1/f', Number.MAX_SAFE_INTEGER), object('w1/z', 1)]), /total/i);
});

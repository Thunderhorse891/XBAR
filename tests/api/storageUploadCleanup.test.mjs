import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { recordNewStoredObject } from '../../api/_lib/stored-record.js';

const path = 'workspace/new-generated.pdf';
const row = { workspace_id: 'workspace', document_id: 'new', storage_path: path };
function fixture(write, { references = { data: [] }, removal = { data: [{ name: path }] }, throws = false } = {}) {
  const calls = [];
  let reading = false;
  const query = {
    insert(value) {
      assert.deepEqual(value, row);
      calls.push('insert');
      return query;
    },
    select() {
      return query;
    },
    eq(key, value) {
      calls.push([key, value]);
      return query;
    },
    limit() {
      return query;
    },
    maybeSingle() {
      return query;
    },
    then(resolve, reject) {
      if (throws && !reading) return Promise.reject(Error('response lost')).then(resolve, reject);
      return Promise.resolve(reading ? references : write).then(resolve, reject);
    },
  };
  let count = 0;
  const supabase = {
    from(table) {
      assert.equal(table, 'documents');
      reading = count++ > 0;
      return query;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'horse-documents');
        return {
          async remove(paths) {
            calls.push(['remove', paths]);
            if (removal instanceof Error) throw removal;
            return removal;
          },
        };
      },
    },
  };
  return {
    calls,
    run: () =>
      recordNewStoredObject({
        supabase,
        bucket: 'horse-documents',
        path,
        table: 'documents',
        key: 'document_id',
        pathColumn: 'storage_path',
        row,
      }),
  };
}
const rejected = { data: null, error: { code: 'P0001', message: 'storage limit reached' } };

test('confirmed insert preserves the new object and returns success', async () => {
  const f = fixture({ data: row, error: null });
  assert.deepEqual(await f.run(), { ok: true });
  assert.deepEqual(f.calls, ['insert']);
});
test('even a definitive rejection retains the original until reference-safe retirement exists', async () => {
  const f = fixture(rejected);
  assert.deepEqual(await f.run(), { ok: false, message: 'storage limit reached', cleanup: 'retained' });
  assert.deepEqual(f.calls, ['insert']);
});

for (const [label, write, options] of [
  ['transport throw', null, { throws: true }],
  ['returned timeout', { data: null, error: { code: '57014', message: 'timeout' } }, {}],
  ['unknown error', { data: null, error: { message: 'fetch failed' } }, {}],
  ['zero returned rows', { data: null, error: null }, {}],
  ['wrong returned identity', { data: { ...row, document_id: 'other' }, error: null }, {}],
  ['a reference exists', rejected, { references: { data: [{ document_id: 'other-reference' }] } }],
  ['reference lookup fails', rejected, { references: { data: null, error: { message: 'offline' } } }],
  ['reference lookup missing data', rejected, { references: { error: null } }],
  ['contradictory error and returned row', { ...rejected, data: row }, {}],
])
  test(`${label}: preserve bytes and never claim record success`, async () => {
    const f = fixture(write, options);
    assert.equal((await f.run()).ok, false);
    assert.equal(
      f.calls.some((call) => Array.isArray(call) && call[0] === 'remove'),
      false,
    );
  });
for (const removal of [{ error: { message: 'refused' } }, { data: [] }, new Error('lost response')])
  test('cleanup is never attempted, even if its transport would fail or be uncertain', async () => {
    const f = fixture(rejected, { removal });
    assert.equal((await f.run()).cleanup, 'retained');
    assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === 'remove').length, 0);
  });
for (const name of [
  'api/_lib/documents-generate-template.js',
  'api/sale-packets.js',
  'api/_lib/documents-bulk-upload.js',
])
  test(`${name} cannot overwrite originals while creating fresh objects`, () => {
    const source = readFileSync(name, 'utf8');
    assert.doesNotMatch(source, /upsert:\s*true/);
    assert.match(source, /uploadReservedBuffer\(/, 'originals must use the reserved, non-overwriting transport');
    assert.doesNotMatch(source, /\.upload\(/, 'direct storage writes cannot bypass the reservation');
    assert.doesNotMatch(source, /\.remove\(/, 'failed writes retain originals for recovery');
    if (!name.includes('bulk')) assert.match(source, /recordNewStoredObject\(/);
  });

test('a payload-only synced reference cannot authorize deletion of its original', async () => {
  const existing = { ...row, document_id: 'synced', storage_path: '', payload: { storagePath: path } };
  // This is what the dedicated storage_path lookup returns for a client-synced
  // document, whose canonical file reference is stored inside its payload.
  const f = fixture(rejected, { references: { data: existing.storage_path === path ? [existing] : [] } });
  assert.equal((await f.run()).cleanup, 'retained');
  assert.equal(
    f.calls.some((call) => Array.isArray(call) && call[0] === 'remove'),
    false,
  );
});

test('a no-reference snapshot is not an atomic guarantee that removal is safe', async () => {
  const f = fixture(rejected, { references: { data: [] } });
  // A reference can be published immediately after this read. With no atomic
  // ownership/retirement fence, the only safe result is to retain the bytes.
  assert.equal((await f.run()).cleanup, 'retained');
  assert.equal(
    f.calls.some((call) => Array.isArray(call) && call[0] === 'remove'),
    false,
  );
});

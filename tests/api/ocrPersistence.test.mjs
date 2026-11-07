import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Readable } from 'node:stream';

const workspace = '11111111-1111-4111-8111-111111111111';
const clone = (v) => structuredClone(v);
const keys = {
  horses: 'horse_id',
  documents: 'document_id',
  document_processing_jobs: 'job_id',
  reminders: 'reminder_id',
  intake_batches: 'intake_batch_id',
};
function fixture(failure = {}) {
  const tables = {
    documents: [
      {
        workspace_id: workspace,
        document_id: 'doc-a',
        horse_id: '',
        state: 'Queued',
        needs_review: true,
        updated_at: '2026-11-01T00:00:00Z',
        extracted_data: { name: 'Blue', nextDueDate: '2026-12-01' },
        ocr_confidence_map: { name: 1 },
        confidence: 1,
        payload: { pipelineType: 'coggins' },
      },
    ],
    document_processing_jobs: [
      { workspace_id: workspace, document_id: 'doc-a', job_id: 'job-a', horse_id: '', status: 'needs_review' },
    ],
    horses: [],
    reminders: [],
    workspace_profiles: [],
    intake_batches: [],
    audit_logs: [],
  };
  const calls = [];
  let used = false;
  const storage = [];
  const supabase = {
    storage: {
      from: () => ({
        upload: async (name) => {
          storage.push(name);
          return { data: { path: name }, error: null };
        },
        remove: async (names) => {
          for (const n of names) storage.splice(storage.indexOf(n), 1);
          return { data: names.map((name) => ({ name })), error: null };
        },
      }),
    },
    from(table) {
      let action = 'read',
        values,
        single = false,
        nameSearch = false;
      const filters = [];
      const query = {
        select() {
          return query;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return query;
        },
        in(k, v) {
          filters.push((r) => v.includes(r[k]));
          return query;
        },
        is(k, v) {
          filters.push((r) => (r[k] ?? null) === v);
          return query;
        },
        ilike(k, v) {
          nameSearch = true;
          filters.push((r) => String(r[k]).toLowerCase() === String(v).toLowerCase());
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle() {
          single = true;
          return query;
        },
        upsert(v) {
          action = 'upsert';
          values = v;
          return query;
        },
        insert(v) {
          action = 'insert';
          values = v;
          return query;
        },
        update(v) {
          action = 'update';
          values = v;
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve()
            .then(() => {
              calls.push({ table, action, values: clone(values) });
              const fail =
                !used &&
                failure.table === table &&
                (!failure.action || failure.action === action) &&
                (!failure.nameOnly || nameSearch);
              if (fail) used = true;
              if (fail && failure.before) failure.before(tables);
              if (fail && !failure.after && !['wrong', 'partial', 'race'].includes(failure.kind)) {
                if (failure.kind === 'throw') throw Error('private database detail');
                if (failure.kind === 'missing-data') return { error: null };
                if (failure.kind === 'null-data') return { data: null, error: null };
                return {
                  data: failure.kind === 'zero' ? [] : null,
                  error: failure.kind === 'zero' ? null : { message: 'private database detail', code: failure.code },
                };
              }
              let rows = tables[table].filter((r) => filters.every((f) => f(r)));
              if (action === 'update') {
                for (const row of rows) Object.assign(row, clone(values));
                for (const row of rows)
                  if (row.updated_at) row.updated_at = new Date(row.updated_at).toISOString().replace('Z', '+00:00');
              }
              if (action === 'insert' || action === 'upsert') {
                rows = [];
                for (const value of Array.isArray(values) ? values : [values]) {
                  const old =
                    keys[table] &&
                    tables[table].find(
                      (r) => r.workspace_id === value.workspace_id && r[keys[table]] === value[keys[table]],
                    );
                  if (old && action === 'insert') return { data: null, error: { code: '23505', message: 'duplicate' } };
                  const row = old || {};
                  Object.assign(row, clone(value));
                  row.updated_at ||= '2026-11-01T00:00:00+00:00';
                  if (!old) tables[table].push(row);
                  rows.push(row);
                }
              }
              if (fail && failure.after) {
                if (failure.kind === 'throw') throw Error('response lost after commit');
                return { data: null, error: { message: 'response lost after commit' } };
              }
              let data = clone(rows);
              if (fail && failure.kind === 'wrong' && data[0]) data[0][keys[table]] = 'wrong-target';
              if (fail && failure.kind === 'partial') data = data.slice(0, -1);
              return { data: single ? data[0] || null : data, error: null };
            })
            .then(resolve, reject);
        },
      };
      return query;
    },
  };
  return {
    tables,
    calls,
    storage,
    supabase,
    get failureUsed() {
      return used;
    },
  };
}

const file = 'api/_lib/documents-bulk-upload.js';
const base = pathToFileURL(path.resolve(file));
const source = readFileSync(file, 'utf8').replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_m, _q, relative) => {
  const url = new URL(relative, base);
  if (url.pathname.endsWith('/supabase-admin.js'))
    return 'from "data:text/javascript,export const requireWorkspaceAccess=async()=>globalThis.__ocrPersistenceAccess"';
  if (url.pathname.endsWith('/rate-limit.js'))
    return 'from "data:text/javascript,export const enforceRateLimit=async()=>true"';
  if (url.pathname.endsWith('/entitlements.js'))
    return 'from "data:text/javascript,export const getWorkspaceEntitlements=async()=>({ok:true,limits:{horseLimit:100}});export const checkHorseCapacity=async()=>({ok:true,used:0});export const checkDocumentCapacity=async()=>({ok:true});export const checkStorageCapacity=async()=>({ok:true})"';
  return `from '${url.href}'`;
});
const handler = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
async function invoke(f, body = {}) {
  globalThis.__ocrPersistenceAccess = {
    ok: true,
    role: 'Admin',
    user: { id: 'synthetic-user', email: 'test@example.invalid' },
    supabase: f.supabase,
  };
  const req = Readable.from([
    JSON.stringify({
      workspaceId: workspace,
      mode: 'commit',
      assignments: [{ action: 'create-horse', documentIds: ['doc-a'] }],
      ...body,
    }),
  ]);
  Object.assign(req, { method: 'POST', headers: {}, url: '/api/documents/bulk-upload-with-ocr' });
  const res = {
    setHeader() {},
    end(v) {
      this.body = JSON.parse(v);
    },
  };
  await handler(req, res);
  return res;
}

for (const table of ['horses', 'documents', 'document_processing_jobs', 'reminders']) {
  for (const kind of ['error', 'zero', 'throw', 'wrong']) {
    test(`${table} ${kind} cannot report a committed assignment`, async () => {
      const f = fixture({
        table,
        action: table === 'horses' ? 'insert' : table === 'reminders' ? 'insert' : 'update',
        kind,
      });
      const response = await invoke(f);
      assert.equal(response.body.ok, false);
      assert.equal(f.failureUsed, true, 'the intended IO failure was reached');
      assert.ok(response.statusCode >= 400);
      assert.equal(response.body.results[0].ok, false);
      assert.equal(response.body.retryable, false);
      assert.ok(!JSON.stringify(response.body).includes('private database detail'));
      if (table === 'horses') assert.equal(f.tables.documents[0].horse_id, '');
    });
  }
}
test('missing requested documents refuse all writes', async () => {
  const f = fixture();
  const r = await invoke(f, { assignments: [{ action: 'create-horse', documentIds: ['doc-a', 'missing'] }] });
  assert.equal(r.body.ok, false);
  assert.equal(f.calls.filter((c) => c.action !== 'read').length, 0);
});
test('duplicate document IDs refuse all writes', async () => {
  const f = fixture();
  const r = await invoke(f, { assignments: [{ action: 'create-horse', documentIds: ['doc-a', 'doc-a'] }] });
  assert.equal(r.body.ok, false);
  assert.equal(f.calls.filter((c) => c.action !== 'read').length, 0);
});
test('read failures are not absence or permission to create', async () => {
  for (const table of ['documents', 'workspace_profiles']) {
    const f = fixture({ table, action: 'read', kind: 'error' });
    const r = await invoke(f);
    assert.equal(r.body.ok, false);
    assert.equal(f.tables.horses.length, 0);
  }
});
test('success survives reload and exact retry without another horse or reminder', async () => {
  const f = fixture();
  const first = await invoke(f);
  assert.equal(first.body.ok, true);
  const horseId = first.body.results[0].horseId;
  assert.equal(f.tables.documents[0].horse_id, horseId);
  assert.equal(f.tables.document_processing_jobs[0].horse_id, horseId);
  assert.equal(f.tables.reminders.length, 1);
  f.tables.horses[0].name = 'Owner-confirmed name';
  const retry = await invoke(f);
  assert.equal(retry.body.ok, true);
  assert.equal(retry.body.results[0].horseId, horseId);
  assert.equal(f.tables.horses.length, 1);
  assert.equal(f.tables.horses[0].name, 'Owner-confirmed name');
  assert.equal(f.tables.reminders.length, 1);
});
for (const table of ['horses', 'documents', 'document_processing_jobs', 'reminders']) {
  test(`lost ${table} acknowledgment retains a recoverable target and retry does not duplicate`, async () => {
    const f = fixture({
      table,
      action: table === 'horses' ? 'insert' : table === 'reminders' ? 'insert' : 'update',
      kind: 'throw',
      after: true,
    });
    const first = await invoke(f);
    assert.equal(first.body.ok, false);
    assert.equal(first.body.retryable, false);
    assert.ok(first.body.results[0].horseId);
    assert.equal(first.body.results[0].needsRecovery, true);
    const retry = await invoke(f);
    assert.equal(retry.body.ok, true);
    assert.equal(retry.body.results[0].horseId, first.body.results[0].horseId);
    assert.equal(f.tables.horses.length, 1);
    assert.equal(f.tables.reminders.length, 1);
  });
}
test('a missing processing job is not reported completed', async () => {
  const f = fixture();
  f.tables.document_processing_jobs = [];
  const r = await invoke(f);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.results[0].ok, false);
});
test('one rejected assignment makes the batch incomplete without discarding earlier receipts', async () => {
  const f = fixture();
  const r = await invoke(f, {
    assignments: [
      { action: 'create-horse', documentIds: ['doc-a'] },
      { action: 'attach-horse', horseId: 'missing', documentIds: ['doc-a'] },
    ],
  });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.results[0].ok, true);
  assert.equal(r.body.results[1].ok, false);
  assert.equal(f.tables.horses.length, 1);
});

const upload = {
  mode: 'preview',
  files: [
    {
      fileName: 'registration.txt',
      contentBase64: Buffer.from('original file').toString('base64'),
      providedConfidence: 1,
      providedText:
        'ARABIAN HORSE ASSOCIATION\nCertificate of Registration\nHorse Name: Spirit of the Desert\nRegistration Number: AHA 0654321\nBreed: Arabian\nColor: Bay\nSex: Mare\nDate Foaled: 04/12/2019\nSire: Desert Wind\nDam: Morning Glory\nDNA Status: On File\nMicrochip Number: 985112004567890',
    },
  ],
};
for (const [table, action] of [
  ['intake_batches', 'insert'],
  ['documents', 'insert'],
  ['document_processing_jobs', 'insert'],
  ['intake_batches', 'update'],
]) {
  for (const kind of ['error', 'zero', 'throw', 'wrong']) {
    test(`preview ${table} ${action} ${kind} is incomplete and keeps recovery references`, async () => {
      const f = fixture({ table, action, kind });
      const r = await invoke(f, upload);
      assert.equal(r.body.ok, false);
      assert.equal(f.failureUsed, true, 'the intended IO failure was reached');
      assert.ok(r.statusCode >= 400);
      assert.equal(r.body.retryable, false);
      assert.ok(r.body.batchId);
      assert.ok(Array.isArray(r.body.recovery.files));
      assert.ok(!JSON.stringify(r.body).includes('private database detail'));
      if (table === 'intake_batches' && action === 'insert') assert.equal(f.storage.length, 0);
    });
  }
}
test('a lost document save response never deletes the original that may already be referenced', async () => {
  const f = fixture({ table: 'documents', action: 'insert', kind: 'throw', after: true });
  const r = await invoke(f, upload);
  assert.equal(r.body.ok, false);
  assert.equal(f.storage.length, 1);
  const persisted = f.tables.documents.find((d) => d.original_filename === 'registration.txt');
  assert.ok(persisted);
  assert.equal(persisted.storage_path, f.storage[0]);
  assert.equal(r.body.recovery.files[0].documentId, persisted.document_id);
  assert.ok(f.tables.intake_batches[0].payload.files.some((d) => d.documentId === persisted.document_id));
});
test('preview acknowledges the stored document and job; commit reuses those originals', async () => {
  const f = fixture();
  const preview = await invoke(f, upload);
  assert.equal(preview.body.ok, true);
  assert.equal(preview.body.documents.length, 1);
  const id = preview.body.documents[0].documentId;
  assert.ok(f.tables.documents.some((d) => d.document_id === id));
  assert.ok(f.tables.document_processing_jobs.some((d) => d.document_id === id));
  const committed = await invoke(f, { assignments: [{ action: 'create-horse', documentIds: [id] }] });
  assert.equal(committed.body.ok, true);
  assert.equal(f.storage.length, 1);
  assert.equal(f.tables.documents.find((d) => d.document_id === id).horse_id, committed.body.results[0].horseId);
});
test('automatic processing reports saved links rather than just a proposed horse', async () => {
  const f = fixture();
  const result = await invoke(f, { ...upload, mode: 'auto' });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.summary.autoCommitted, 1);
  const p = result.body.proposals[0];
  assert.equal(p.action, 'created');
  assert.equal(f.tables.documents.find((d) => d.document_id === p.documentIds[0]).horse_id, p.horseId);
  assert.equal(f.tables.document_processing_jobs.find((d) => d.document_id === p.documentIds[0]).horse_id, p.horseId);
});
test('automatic horse lookup errors cannot create a second horse', async () => {
  const f = fixture({ table: 'horses', action: 'read', kind: 'error' });
  const r = await invoke(f, { ...upload, mode: 'auto' });
  assert.equal(r.body.ok, false);
  assert.equal(f.tables.horses.length, 0);
});

test('missing horse-read data and malformed name-search responses never mean no horse exists', async () => {
  const f = fixture({ table: 'horses', action: 'read', kind: 'missing-data' });
  assert.equal((await invoke(f)).body.ok, false);
  assert.equal(f.tables.horses.length, 0);
  const names = fixture({ table: 'horses', action: 'read', kind: 'null-data', nameOnly: true });
  assert.equal((await invoke(names, { ...upload, mode: 'auto' })).body.ok, false);
  assert.equal(names.failureUsed, true);
  assert.equal(names.tables.horses.length, 0);
});

test('an interrupted preview can commit its saved extraction without uploading another original', async () => {
  const f = fixture({ table: 'document_processing_jobs', action: 'insert', kind: 'error' });
  const preview = await invoke(f, upload);
  assert.equal(preview.body.ok, false);
  const id = preview.body.recovery.files[0].documentId;
  assert.equal(f.tables.document_processing_jobs.filter((j) => j.document_id === id).length, 0);
  const commit = await invoke(f, { assignments: [{ action: 'create-horse', documentIds: [id] }] });
  assert.equal(commit.body.ok, true);
  assert.equal(f.storage.length, 1);
  assert.equal(
    f.tables.document_processing_jobs.filter((j) => j.document_id === id && j.status === 'completed').length,
    1,
  );
});

test('an interrupted automatic assignment resumes through explicit commit with the same horse', async () => {
  const f = fixture({ table: 'document_processing_jobs', action: 'update', kind: 'error' });
  const first = await invoke(f, { ...upload, mode: 'auto' });
  assert.equal(first.body.ok, false);
  assert.equal(f.tables.horses.length, 1);
  const retry = await invoke(f, {
    assignments: [{ action: 'create-horse', documentIds: first.body.recovery.currentDocumentIds }],
  });
  assert.equal(retry.body.ok, true);
  assert.equal(retry.body.results[0].horseId, first.body.recovery.horseId);
  assert.equal(f.tables.horses.length, 1);
  assert.equal(f.storage.length, 1);
});
test('a definitive rejected insert cleans only the newly uploaded unreferenced object', async () => {
  const f = fixture({ table: 'documents', action: 'insert', kind: 'error', code: 'P0001' });
  const r = await invoke(f, upload);
  assert.equal(r.body.ok, false);
  assert.equal(f.storage.length, 0);
  assert.equal(r.body.recovery.files[0].originalRemoved, true);
});
test('client-supplied originals are never removed after row rejection', async () => {
  const f = fixture({ table: 'documents', action: 'insert', kind: 'error', code: 'P0001' });
  const supplied = `${workspace}/documents/prior/original.txt`;
  const r = await invoke(f, { ...upload, files: [{ ...upload.files[0], storagePath: supplied }] });
  assert.equal(r.body.ok, false);
  assert.notEqual(r.body.recovery.files[0].originalRemoved, true);
});
test('two concurrent identical creations use one horse identity', async () => {
  const f = fixture();
  const responses = await Promise.all([invoke(f), invoke(f)]);
  assert.equal(f.tables.horses.length, 1);
  assert.ok(responses.some((r) => r.body.ok));
  const retry = await invoke(f);
  assert.equal(retry.body.ok, true);
  assert.equal(f.tables.horses.length, 1);
});
test('a changed create request cannot overwrite the prior operation or create another horse', async () => {
  const f = fixture();
  assert.equal((await invoke(f)).body.ok, true);
  const r = await invoke(f, {
    assignments: [{ action: 'create-horse', documentIds: ['doc-a'], overrides: { name: 'Different horse' } }],
  });
  assert.equal(r.body.ok, false);
  assert.equal(f.tables.horses.length, 1);
  assert.equal(f.tables.horses[0].name, 'Blue');
});
test('unknown first write stops later assignments and reports them unattempted', async () => {
  const f = fixture({ table: 'horses', action: 'insert', kind: 'throw', after: true });
  const r = await invoke(f, {
    assignments: [
      { action: 'create-horse', documentIds: ['doc-a'] },
      { action: 'create-horse', documentIds: ['doc-b'] },
    ],
  });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.results[1].phase, 'not-attempted');
  assert.equal(f.calls.filter((c) => c.table === 'horses' && c.action === 'insert').length, 1);
});
for (const table of ['documents', 'document_processing_jobs'])
  test(`concurrent ${table} relinking is preserved`, async () => {
    const f = fixture({
      table,
      action: 'update',
      kind: 'race',
      before: (tables) => {
        tables[table][0].horse_id = 'another-horse';
      },
    });
    const r = await invoke(f);
    assert.equal(r.body.ok, false);
    assert.equal(f.tables[table][0].horse_id, 'another-horse');
  });
test('a concurrent owner field edit is not overwritten when attaching OCR', async () => {
  const f = fixture({
    table: 'horses',
    action: 'update',
    kind: 'race',
    before: (tables) => {
      tables.horses[0].breed = 'Owner verified';
    },
  });
  f.tables.horses = [
    { workspace_id: workspace, horse_id: 'existing', name: 'Blue', breed: '', updated_at: '2026-11-01T00:00:00Z' },
  ];
  const r = await invoke(f, {
    assignments: [
      { action: 'attach-horse', horseId: 'existing', documentIds: ['doc-a'], overrides: { breed: 'OCR guess' } },
    ],
  });
  assert.equal(r.body.ok, false);
  assert.equal(f.tables.horses[0].breed, 'Owner verified');
  assert.equal(f.tables.documents[0].horse_id, '');
});
for (const table of ['document_processing_jobs', 'reminders'])
  test(`${table} lookup errors refuse completion`, async () => {
    const f = fixture({ table, action: 'read', kind: 'error' });
    const r = await invoke(f);
    assert.equal(r.body.ok, false);
    assert.equal(f.failureUsed, true);
  });

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
const source = readFileSync(file, 'utf8')
  .replace(
    "import { createHash, randomUUID } from 'node:crypto';",
    "import { createHash, randomUUID as cryptoRandomUUID } from 'node:crypto'; const randomUUID = () => globalThis.__ocrPersistenceUuids?.shift() ?? cryptoRandomUUID();",
  )
  .replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_m, _q, relative) => {
    const url = new URL(relative, base);
    if (url.pathname.endsWith('/supabase-admin.js'))
      return 'from "data:text/javascript,export const requireWorkspaceAccess=async()=>globalThis.__ocrPersistenceAccess"';
    if (url.pathname.endsWith('/rate-limit.js'))
      return 'from "data:text/javascript,export const enforceRateLimit=async()=>true"';
    if (url.pathname.endsWith('/entitlements.js'))
      return 'from "data:text/javascript,export const getWorkspaceEntitlements=async()=>({ok:true,effectiveTier:globalThis.__ocrPersistenceTier||\'Starter\',limits:{horseLimit:100}});export const checkHorseCapacity=async()=>({ok:true,used:0});export const checkDocumentCapacity=async()=>({ok:true});export const checkStorageCapacity=async()=>({ok:true})"';
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

const existingIdentity = (overrides = {}) => ({
  workspace_id: workspace,
  horse_id: 'existing-horse',
  name: 'Spirit of the Desert',
  registration_number: 'AHA0654321',
  microchip: '985112004567890',
  updated_at: '2026-11-01T00:00:00Z',
  payload: {},
  ...overrides,
});
for (const [name, horses, extraText] of [
  [
    'same name but different strong identifiers',
    [existingIdentity({ registration_number: 'OTHER', microchip: 'OTHER' })],
  ],
  ['registration match but different microchip', [existingIdentity({ microchip: 'OTHER' })]],
  ['microchip match but different registration', [existingIdentity({ registration_number: 'OTHER' })]],
  ['strong identifier but different name', [existingIdentity({ name: 'Another Horse' })]],
  [
    'identifiers point at different horses',
    [existingIdentity({ microchip: '' }), existingIdentity({ horse_id: 'second', registration_number: '' })],
  ],
  ['duplicate registration matches', [existingIdentity(), existingIdentity({ horse_id: 'duplicate', microchip: '' })]],
  [
    'multiple name matches',
    [
      existingIdentity({ registration_number: '', microchip: '' }),
      existingIdentity({ horse_id: 'second', registration_number: '', microchip: '' }),
    ],
  ],
  ['conflicting source names despite a registration match', [existingIdentity()], '\nHorse Name: Another Horse'],
]) {
  test(`automatic identity review holds ${name} without changing horses or losing originals`, async () => {
    const f = fixture();
    f.tables.horses = clone(horses);
    const before = clone(horses);
    const result = await invoke(f, {
      ...upload,
      mode: 'auto',
      files: [
        {
          ...upload.files[0],
          providedText: extraText
            ? upload.files[0].providedText.replace('Registration Number:', `${extraText}\nRegistration Number:`)
            : upload.files[0].providedText,
        },
      ],
    });
    assert.equal(result.body.ok, true);
    assert.equal(result.body.summary.autoCommitted, 0);
    assert.equal(result.body.proposals[0].action, 'review');
    assert.equal(result.body.proposals[0].matchedHorseId, '');
    assert.equal(result.body.proposals[0].needsReview, true);
    assert.deepEqual(f.tables.horses, before);
    assert.equal(f.storage.length, 1);
    for (const id of result.body.proposals[0].documentIds) {
      const doc = f.tables.documents.find((d) => d.document_id === id);
      assert.equal(doc.horse_id, '');
      assert.equal(doc.state, 'Needs Review');
      assert.equal(doc.needs_review, true);
      assert.equal(f.tables.document_processing_jobs.find((j) => j.document_id === id).status, 'needs_review');
      assert.equal(result.body.documents.find((d) => d.documentId === id).state, 'Needs Review');
    }
    assert.equal(f.tables.intake_batches[0].state, 'needs-review');
    assert.equal(f.tables.reminders.length, 0);
  });
}

for (const [name, overrides] of [
  ['consistent strong identity', {}],
  ['unique name without stored identifiers', { registration_number: '', microchip: '' }],
]) {
  test(`automatic attachment preserves ${name}`, async () => {
    const f = fixture();
    f.tables.horses = [existingIdentity(overrides)];
    const result = await invoke(f, { ...upload, mode: 'auto' });
    assert.equal(result.body.ok, true, JSON.stringify(result.body));
    assert.equal(result.body.summary.autoCommitted, 1);
    assert.equal(result.body.proposals[0].action, 'attached');
    assert.equal(result.body.proposals[0].horseId, 'existing-horse');
    assert.equal(f.tables.horses.length, 1);
    assert.equal(f.storage.length, 1);
  });
}

test('identity hold write failures refuse batch success and preserve originals', async () => {
  const f = fixture({ table: 'document_processing_jobs', action: 'update', kind: 'error' });
  f.tables.horses = [existingIdentity({ microchip: 'OTHER' })];
  const before = clone(f.tables.horses);
  const result = await invoke(f, { ...upload, mode: 'auto' });
  assert.equal(result.body.ok, false);
  assert.equal(f.failureUsed, true);
  assert.deepEqual(f.tables.horses, before);
  assert.equal(f.storage.length, 1);
  assert.equal(result.body.recovery.files[0].documentSaved, true);
});

test('same-identifier documents with contradictory names are held together', async () => {
  const f = fixture();
  f.tables.horses = [existingIdentity()];
  const before = clone(f.tables.horses);
  const result = await invoke(f, {
    ...upload,
    mode: 'auto',
    files: [
      upload.files[0],
      {
        ...upload.files[0],
        fileName: 'second.txt',
        providedText: upload.files[0].providedText.replace('Spirit of the Desert', 'Another Horse'),
      },
    ],
  });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.summary.autoCommitted, 0);
  assert.deepEqual(f.tables.horses, before);
  assert.equal(f.storage.length, 2);
  assert.equal(result.body.proposals.length, 1);
  assert.equal(result.body.proposals[0].documentIds.length, 2);
  assert.ok(result.body.documents.every((d) => d.state === 'Needs Review' && !d.horseId));
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

test('equal-confidence source fields recover identically when upload and document-ID orders differ', async (t) => {
  globalThis.__ocrPersistenceUuids = [
    '00000000-0000-4000-8000-000000000000',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    '00000000-0000-4000-8000-000000000001',
  ];
  t.after(() => {
    delete globalThis.__ocrPersistenceUuids;
  });
  const f = fixture({ table: 'document_processing_jobs', action: 'update', kind: 'error' });
  const first = await invoke(f, {
    ...upload,
    mode: 'auto',
    files: [
      upload.files[0],
      {
        ...upload.files[0],
        fileName: 'second-registration.txt',
        providedText: upload.files[0].providedText.replace('Bay', 'Chestnut'),
      },
    ],
  });
  assert.equal(first.body.ok, false);
  assert.equal(f.failureUsed, true);
  assert.equal(f.tables.horses.length, 1);
  const ids = first.body.recovery.files.map((file) => file.documentId);
  assert.ok(ids[0] > ids[1], 'fixture must reverse upload order under ID sorting');
  const savedHorse = clone(f.tables.horses[0]);
  const retry = await invoke(f, { assignments: [{ action: 'create-horse', documentIds: ids }] });
  assert.equal(retry.body.ok, true, JSON.stringify(retry.body));
  assert.equal(retry.body.results[0].horseId, savedHorse.horse_id);
  assert.deepEqual(f.tables.horses, [savedHorse], 'recovery must preserve the original horse fields');
  assert.equal(f.storage.length, 2);
  for (const id of ids) {
    assert.equal(f.tables.documents.find((d) => d.document_id === id).horse_id, savedHorse.horse_id);
    assert.equal(f.tables.document_processing_jobs.find((j) => j.document_id === id).status, 'completed');
  }
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
for (const table of ['documents', 'document_processing_jobs'])
  test(`identity hold preserves a concurrent ${table} assignment`, async () => {
    const f = fixture({
      table,
      action: 'update',
      kind: 'race',
      before: (tables) => {
        const row = tables[table].find((d) => d.document_id !== 'doc-a');
        row.horse_id = 'owner-selected-horse';
        if (table === 'documents') {
          row.state = 'Ready';
          row.needs_review = false;
        } else row.status = 'completed';
      },
    });
    f.tables.horses = [existingIdentity({ microchip: 'OTHER' })];
    const r = await invoke(f, { ...upload, mode: 'auto' });
    assert.equal(r.body.ok, false);
    const row = f.tables[table].find((d) => d.document_id !== 'doc-a');
    assert.equal(row.horse_id, 'owner-selected-horse');
    assert.equal(table === 'documents' ? row.state : row.status, table === 'documents' ? 'Ready' : 'completed');
  });

test('Free OCR preview/auto is rejected before remote file download or any write', async () => {
  globalThis.__ocrPersistenceTier = 'Free';
  try {
    for (const mode of ['preview', 'auto']) {
      const f = fixture();
      const before = clone(f.tables);
      const response = await invoke(f, {
        mode,
        files: [{ fileName: 'paid.pdf', storagePath: `${workspace}/documents/paid.pdf` }],
      });
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.code, 'paid_ocr_required');
      assert.deepEqual(f.tables, before);
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.storage, []);
    }
  } finally {
    delete globalThis.__ocrPersistenceTier;
  }
});

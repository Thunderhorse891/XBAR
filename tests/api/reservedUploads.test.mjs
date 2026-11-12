import { readFileSync, readdirSync } from 'node:fs';
import documentRouter, { config as documentConfig } from '../../api/documents/[action].js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { createUploadHandler } from '../../api/_lib/storage-uploads.js';
import {
  createUploadService,
  uploadReservedBuffer,
  UPLOAD_PART_SIZE,
  publicUpload,
  mediaHorseSegment,
} from '../../api/_lib/storage-upload.js';
import { createStorageTransport, storageTransportForClient } from '../../api/_lib/storage-s3.js';
const WS = '10000000-0000-0000-0000-000000000001';
const USER = '20000000-0000-0000-0000-000000000002';
const ID = '30000000-0000-0000-0000-000000000003';
const OTHER = '40000000-0000-0000-0000-000000000004';
const clone = (x) => structuredClone(x);
const createBody = (extra = {}) => ({
  action: 'create',
  workspaceId: WS,
  requestId: ID,
  bucket: 'horse-documents',
  kind: 'document',
  fileName: 'original.pdf',
  contentType: 'application/pdf',
  sizeBytes: 5,
  ...extra,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

function fixture(options = {}) {
  const rows = new Map();
  const calls = [];
  let actual = null;
  let inventory = [{ PartNumber: 1, Size: 5, ETag: 'etag' }];
  const transport = {
    async create() {
      calls.push('create');
      if (options.create) return options.create();
      return 'provider-secret-id';
    },
    async findCreated() {
      return options.foundId || null;
    },
    async signPart(row, number, size) {
      calls.push(['sign', number, size]);
      return `https://project.supabase.co/storage/v1/s3/${row.bucket_id}/${row.object_path}?partNumber=${number}`;
    },
    async putPart(row, number, bytes) {
      calls.push(['put', number, bytes.byteLength]);
    },
    async listParts() {
      calls.push('list');
      if (options.list) return options.list();
      return inventory;
    },
    async complete(row, parts) {
      calls.push(['complete', parts]);
      if (options.complete) return options.complete((value) => (actual = value));
      actual = { sizeBytes: Number(row.expected_bytes) };
    },
    async head() {
      calls.push('head');
      if (options.head) return options.head();
      return actual;
    },
    async abort() {
      calls.push('abort');
      return options.abort ? options.abort() : true;
    },
  };
  const supabase = {
    from(table) {
      assert.equal(table, 'workspace_upload_reservations');
      const filters = [];
      const query = {
        select: () => query,
        eq(key, value) {
          filters.push((r) => r[key] === value);
          return query;
        },
        neq(key, value) {
          filters.push((r) => r[key] !== value);
          return query;
        },
        order: () => query,
        limit: () => query,
        async maybeSingle() {
          return { data: clone([...rows.values()].find((r) => filters.every((f) => f(r))) || null) };
        },
        then(resolve) {
          return Promise.resolve({ data: clone([...rows.values()].filter((r) => filters.every((f) => f(r)))) }).then(
            resolve,
          );
        },
      };
      return query;
    },
    async rpc(name, p) {
      calls.push(name);
      if (options.rpcError === name) return { error: { code: 'XX000', message: 'private credential data' } };
      let row = rows.get(p.p_reservation_id);
      const conflict = () => ({ error: { code: '55000', message: 'Conflict' } });
      const held = (action) => row?.claim_action === action && row.claim_token === p.p_claim_token;
      if (name === 'xbar_reserve_upload') {
        if (row) return conflict();
        row = {
          id: p.p_reservation_id,
          workspace_id: p.p_workspace_id,
          actor_user_id: p.p_actor_user_id,
          bucket_id: p.p_bucket_id,
          object_path: p.p_object_path,
          expected_bytes: p.p_expected_bytes,
          content_type: p.p_content_type,
          upload_kind: p.p_upload_kind,
          part_size_bytes: UPLOAD_PART_SIZE,
          state: 'reserved',
          provider_upload_id: null,
          claim_token: null,
          claim_action: null,
          completion_started_at: null,
        };
        rows.set(row.id, row);
      } else if (name === 'xbar_begin_upload') {
        if (row?.state !== 'reserved') return conflict();
        Object.assign(row, { state: 'uploading', claim_token: p.p_claim_token, claim_action: 'create' });
      } else if (name === 'xbar_bind_upload') {
        if (!held('create') || row.provider_upload_id || !['uploading', 'reconcile'].includes(row.state))
          return conflict();
        Object.assign(row, {
          state: 'uploading',
          provider_upload_id: p.p_provider_upload_id,
          claim_token: null,
          claim_action: null,
        });
      } else if (name === 'xbar_claim_upload_completion') {
        if (row?.state !== 'uploading' || !row.provider_upload_id || row.claim_token) return conflict();
        Object.assign(row, { state: 'completing', claim_action: 'verify', claim_token: p.p_claim_token });
      } else if (name === 'xbar_release_upload_completion') {
        if (!held('verify') || row.completion_started_at) return conflict();
        Object.assign(row, { state: 'uploading', claim_token: null, claim_action: null });
      } else if (name === 'xbar_start_upload_completion') {
        if (!held('verify') || row.state !== 'completing') return conflict();
        Object.assign(row, { claim_action: 'complete', completion_started_at: '2026-11-12' });
      } else if (name === 'xbar_claim_upload_abort') {
        if (
          !(row?.state === 'reserved' || (row?.state === 'uploading' && row.provider_upload_id && !row.claim_token)) ||
          row.completion_started_at
        )
          return conflict();
        Object.assign(row, { state: 'aborting', claim_action: 'abort', claim_token: p.p_claim_token });
      } else if (name === 'xbar_mark_upload_reconcile') {
        if (
          !row.claim_token ||
          row.claim_token !== p.p_claim_token ||
          !['uploading', 'completing', 'aborting', 'reconcile'].includes(row.state)
        )
          return conflict();
        row.state = 'reconcile';
      } else if (name === 'xbar_settle_upload_stored') {
        if (!held('complete') || !row.completion_started_at || actual?.sizeBytes !== row.expected_bytes)
          return conflict();
        row.state = 'stored';
      } else if (name === 'xbar_settle_upload_aborted') {
        if (!held('abort') || row.completion_started_at || actual || !p.p_provider_confirmed) return conflict();
        row.state = 'aborted';
      } else throw new Error(name);
      return { data: clone(row), error: null };
    },
  };
  const access = { ok: true, role: options.role || 'Admin', workspaceId: WS, user: { id: USER }, supabase };
  const service = createUploadService(access, transport);
  const handler = createUploadHandler({
    authorize: async (token, workspace) =>
      options.denial ||
      (token === 'token' && workspace === WS ? access : { ok: false, status: 403, message: 'Denied' }),
    makeService: () => service,
    rateLimit: async () => true,
  });
  async function invoke(body, headers = {}, raw) {
    const req = Readable.from([raw ?? JSON.stringify(body)]);
    req.method = 'POST';
    req.url = '/api/storage/uploads';
    req.headers = { authorization: 'Bearer token', 'content-type': 'application/json', ...headers };
    let response;
    await handler(req, {
      setHeader() {},
      end(json) {
        response = { status: this.statusCode, body: JSON.parse(json) };
      },
    });
    return response;
  }
  return {
    service,
    access,
    transport,
    rows,
    calls,
    invoke,
    setInventory: (parts) => (inventory = parts),
    setActual: (value) => (actual = value),
    create: (extra) => service.create(createBody(extra)),
  };
}

test('API denies unauthenticated/outsider before any reservation or S3 action', async () => {
  for (const denial of [
    { ok: false, status: 401, message: 'No user' },
    { ok: false, status: 403, message: 'Outsider' },
  ]) {
    const f = fixture({ denial });
    assert.equal((await f.invoke(createBody())).status, denial.status);
    assert.deepEqual(f.calls, []);
  }
});
for (const [role, kind, allowed] of [
  ['Admin', 'document', true],
  ['Owner', 'document', true],
  ['Medical Lead', 'document', true],
  ['Viewer', 'document', false],
  ['unknown', 'media', false],
  ['Owner', 'media', false],
  ['Medical Lead', 'receipt', false],
  ['Ranch Manager', 'receipt', true],
  ['Sales Lead', 'media', true],
])
  test(`${role} ${kind} capability ${allowed ? 'allowed' : 'denied'} before signing`, async () => {
    const f = fixture({ role });
    const result = await f.invoke(
      createBody({ kind, bucket: kind === 'media' ? 'horse-media' : 'horse-documents', horseId: 'horse-1' }),
    );
    assert.equal(result.status, allowed ? 200 : 403);
    if (!allowed) assert.deepEqual(f.calls, []);
  });
for (const change of [
  { sizeBytes: 0 },
  { sizeBytes: -1 },
  { sizeBytes: 1.2 },
  { sizeBytes: 2 ** 54 },
  { bucket: 'foreign' },
  { kind: 'fake' },
  { contentType: 'x\r\nAuthorization:secret' },
  { requestId: 'bad' },
  { storagePath: `${OTHER}/file` },
  { uploadId: 'chosen' },
  { parts: [] },
  { upsert: true },
])
  test(`invalid upload ${JSON.stringify(change)} never reaches provider`, async () => {
    const f = fixture();
    const result = await f.invoke(createBody(change));
    assert.equal(result.status, 400);
    assert.deepEqual(f.calls, []);
  });
test('small JSON endpoint refuses blob content and oversized bodies', async () => {
  const f = fixture();
  assert.equal((await f.invoke(createBody(), { 'content-type': 'application/octet-stream' })).status, 415);
  assert.equal((await f.invoke(createBody(), {}, 'x'.repeat(16385))).status, 413);
  assert.deepEqual(f.calls, []);
});
test('create signs only bound multipart; public result cannot expose provider claim or secrets', async () => {
  const f = fixture();
  const { body } = await f.invoke(createBody());
  assert.equal(body.ok, true);
  assert.equal(body.upload.status, 'uploading');
  assert.equal(body.parts[0].sizeBytes, 5);
  assert.ok(f.calls.indexOf('xbar_bind_upload') < f.calls.findIndex(Array.isArray));
  assert.doesNotMatch(JSON.stringify(body), /provider-secret|claim_token|claim_action|secretAccessKey|service_role/);
});
test('create replay is idempotent and a conflicting byte size refuses without re-reserving', async () => {
  const f = fixture();
  const row = await f.create();
  assert.equal((await f.create()).object_path, row.object_path);
  await assert.rejects(f.create({ sizeBytes: 6 }), { code: 'upload_request_conflict' });
  assert.equal(f.calls.filter((x) => x === 'create').length, 1);
  assert.equal(f.rows.size, 1);
});
test('foreign workspace and actor cannot read, sign, abort, complete or list reservation', async () => {
  const f = fixture();
  await f.create();
  const other = createUploadService({ ...f.access, workspaceId: OTHER }, f.transport);
  assert.equal(await other.read(ID), null);
  assert.deepEqual(await other.list(), []);
  const otherActor = createUploadService({ ...f.access, user: { id: OTHER } }, f.transport);
  assert.equal(await otherActor.read(ID), null);
  assert.equal((await f.invoke({ action: 'parts', workspaceId: OTHER, requestId: ID, partNumbers: [1] })).status, 403);
});
test('unknown create stays charged, no URLs or second provider create, exact-key status can recover', async () => {
  const f = fixture({
    create: async () => {
      throw Error('response lost secret');
    },
    foundId: 'provider-recovered',
  });
  const first = await f.invoke(createBody());
  assert.equal(first.status, 409);
  assert.equal(first.body.needsRecovery, true);
  assert.equal(f.rows.get(ID).state, 'reconcile');
  assert.equal(f.calls.some(Array.isArray), false);
  await f.create();
  assert.equal(f.calls.filter((x) => x === 'create').length, 1);
  const row = await f.service.status(await f.service.read(ID));
  assert.equal(row.state, 'uploading');
  assert.equal(row.provider_upload_id, 'provider-recovered');
});
test('failed binding never issues a part URL', async () => {
  const f = fixture({ rpcError: 'xbar_bind_upload' });
  const result = await f.invoke(createBody());
  assert.equal(result.body.needsRecovery, true);
  assert.equal(f.calls.some(Array.isArray), false);
  assert.equal(f.rows.get(ID).state, 'reconcile');
});
test('part numbers and exact final-part byte count are server derived', async () => {
  const f = fixture();
  const row = await f.create({ sizeBytes: UPLOAD_PART_SIZE + 7 });
  const parts = await f.service.parts(row, [1, 2]);
  assert.deepEqual(
    parts.map((p) => p.sizeBytes),
    [UPLOAD_PART_SIZE, 7],
  );
  for (const numbers of [[0], [3], [1, 1], [1.2], [], Array.from({ length: 33 }, (_, i) => i + 1)])
    await assert.rejects(f.service.parts(row, numbers), { code: 'invalid_parts' });
});
for (const [name, parts] of [
  ['empty', []],
  ['wrong size', [{ PartNumber: 1, Size: 6, ETag: 'e' }]],
  ['wrong number', [{ PartNumber: 2, Size: 5, ETag: 'e' }]],
  [
    'extra',
    [
      { PartNumber: 1, Size: 5, ETag: 'e' },
      { PartNumber: 2, Size: 1, ETag: 'e' },
    ],
  ],
  ['missing etag', [{ PartNumber: 1, Size: 5 }]],
])
  test(`completion ${name} never invokes Complete and releases verification to resume safely`, async () => {
    const f = fixture();
    const row = await f.create();
    f.setInventory(parts);
    await assert.rejects(f.service.complete(row), { code: 'upload_incomplete' });
    assert.equal(f.rows.get(ID).state, 'uploading');
    assert.equal(
      f.calls.some((x) => Array.isArray(x) && x[0] === 'complete'),
      false,
    );
    assert.equal((await f.service.abort(await f.service.read(ID))).state, 'aborted');
  });
test('subset completion exploit: a two-part reservation cannot complete only first part', async () => {
  const f = fixture();
  const row = await f.create({ sizeBytes: UPLOAD_PART_SIZE + 7 });
  f.setInventory([{ PartNumber: 1, Size: UPLOAD_PART_SIZE, ETag: 'e' }]);
  await assert.rejects(f.service.complete(row), { code: 'upload_incomplete' });
  assert.equal(
    f.calls.some((x) => Array.isArray(x) && x[0] === 'complete'),
    false,
  );
});
test('successful completion confirms HEAD and database inventory before reporting completed; replay does not mutate', async () => {
  const f = fixture();
  const row = await f.service.complete(await f.create());
  assert.equal(publicUpload(row).status, 'completed');
  assert.equal(f.calls.at(-1), 'xbar_settle_upload_stored');
  assert.equal((await f.service.complete(row)).state, 'stored');
  assert.equal(f.calls.filter((x) => Array.isArray(x) && x[0] === 'complete').length, 1);
});
test('lost provider completion response is recovered by observed exact object size and database settlement', async () => {
  const f = fixture({
    complete: async (set) => {
      set({ sizeBytes: 5 });
      throw Error('lost');
    },
  });
  assert.equal((await f.service.complete(await f.create())).state, 'stored');
});
test('unknown completion with absent object stays charged and is never aborted or re-completed', async () => {
  const f = fixture({
    complete: async () => {
      throw Error('unknown');
    },
  });
  await assert.rejects(f.service.complete(await f.create()), { code: 'upload_pending' });
  const row = await f.service.read(ID);
  assert.equal(row.state, 'reconcile');
  await assert.rejects(f.service.abort(row), { code: 'upload_not_abortable' });
  assert.equal((await f.service.status(row)).state, 'reconcile');
  assert.equal(f.calls.includes('abort'), false);
  assert.equal(f.calls.filter((x) => Array.isArray(x) && x[0] === 'complete').length, 1);
});
test('wrong actual byte size does not release capacity or report completed', async () => {
  const f = fixture({ complete: async (set) => set({ sizeBytes: 6 }) });
  await assert.rejects(f.service.complete(await f.create()), { code: 'upload_pending' });
  assert.equal(f.rows.get(ID).state, 'reconcile');
  assert.equal(f.calls.includes('xbar_settle_upload_stored'), false);
});
test('abort and complete CAS race has one winner; abort never deletes finalized bytes', async () => {
  const gate = deferred(),
    entered = deferred();
  const f = fixture({
    list: async () => {
      entered.resolve();
      await gate.promise;
      return [{ PartNumber: 1, Size: 5, ETag: 'e' }];
    },
  });
  const row = await f.create();
  const completing = f.service.complete(row);
  await entered.promise;
  await assert.rejects(f.service.abort(row), { code: 'upload_state_conflict' });
  gate.resolve();
  assert.equal((await completing).state, 'stored');
  assert.equal(f.calls.includes('abort'), false);
});
test('abort winner fences stale completion and is idempotent', async () => {
  const f = fixture();
  const stale = await f.create();
  const aborted = await f.service.abort(stale);
  await assert.rejects(f.service.complete(stale), { code: 'upload_state_conflict' });
  assert.equal((await f.service.abort(aborted)).state, 'aborted');
  assert.equal(f.calls.filter((x) => x === 'abort').length, 1);
});
test('uncertain abort preserves charge then status recovers without any object deletion', async () => {
  let calls = 0;
  const f = fixture({
    abort: async () => {
      if (!calls++) throw Error('lost');
      return true;
    },
  });
  await assert.rejects(f.service.abort(await f.create()), { code: 'upload_pending' });
  assert.equal(f.rows.get(ID).state, 'reconcile');
  assert.equal((await f.service.status(await f.service.read(ID))).state, 'aborted');
});
test('status releasing a verification claim fences its in-flight worker before provider complete', async () => {
  const gate = deferred(),
    entered = deferred();
  const f = fixture({
    list: async () => {
      entered.resolve();
      await gate.promise;
      return [{ PartNumber: 1, Size: 5, ETag: 'e' }];
    },
  });
  const pending = f.service.complete(await f.create());
  await entered.promise;
  assert.equal((await f.service.status(await f.service.read(ID))).state, 'uploading');
  gate.resolve();
  await assert.rejects(pending, { code: 'upload_state_conflict' });
  assert.equal(
    f.calls.some((x) => Array.isArray(x) && x[0] === 'complete'),
    false,
  );
});
test('generated buffers use exact reserved parts and retained random original path', async () => {
  const f = fixture();
  const path = `${WS}/documents/doc-${ID}/generated.pdf`;
  const result = await uploadReservedBuffer({
    access: f.access,
    requestId: ID,
    bucket: 'horse-documents',
    storagePath: path,
    bytes: Buffer.from('hello'),
    contentType: 'application/pdf',
    transport: f.transport,
  });
  assert.deepEqual(result, { data: { path }, error: null });
  assert.equal(f.rows.get(ID).state, 'stored');
  assert.deepEqual(
    f.calls.find((x) => Array.isArray(x) && x[0] === 'put'),
    ['put', 1, 5],
  );
});
test('S3 signer binds content length and fixed part without exposing JWT/session token or completion URL', async () => {
  const client = new S3Client({
    endpoint: 'https://project.supabase.co/storage/v1/s3',
    region: 'test',
    forcePathStyle: true,
    credentials: { accessKeyId: 'synthetic-access', secretAccessKey: 'synthetic-secret' },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const url = await storageTransportForClient(client).signPart(
    { bucket_id: 'horse-documents', object_path: `${WS}/documents/${ID}/a.pdf`, provider_upload_id: 'provider' },
    2,
    7,
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('partNumber'), '2');
  assert.equal(parsed.searchParams.get('uploadId'), 'provider');
  assert.ok(parsed.searchParams.get('X-Amz-SignedHeaders').split(';').includes('content-length'));
  assert.equal(parsed.searchParams.get('X-Amz-Expires'), '300');
  assert.equal(parsed.searchParams.has('X-Amz-Security-Token'), false);
  assert.doesNotMatch(url, /synthetic-secret|eyJ/);
  client.destroy();
});
test('transport fails closed for missing credentials, session-token style credential and foreign endpoint', () => {
  const env = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_STORAGE_S3_REGION: 'test',
    SUPABASE_STORAGE_S3_ACCESS_KEY_ID: 'synthetic-access',
    SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: 'synthetic-secret',
  };
  for (const change of [
    { SUPABASE_STORAGE_S3_ACCESS_KEY_ID: '' },
    { SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: 'eyJ.payload.signature' },
    { SUPABASE_STORAGE_S3_ENDPOINT: 'https://evil.example/storage/v1/s3' },
  ])
    assert.throws(() => createStorageTransport({ ...env, ...change }));
});

test('reservation persisted before an interrupted begin is safely retryable under the same ID', async () => {
  const options = { rpcError: 'xbar_begin_upload' };
  const f = fixture(options);
  await assert.rejects(f.create());
  assert.equal(f.rows.get(ID).state, 'reserved');
  assert.equal(f.calls.includes('create'), false);
  options.rpcError = null;
  assert.equal((await f.create()).state, 'uploading');
  assert.equal(f.calls.filter((x) => x === 'xbar_reserve_upload').length, 1);
  assert.equal(f.calls.filter((x) => x === 'create').length, 1);
});
test('media request ID cannot be replayed for a different horse', async () => {
  const f = fixture();
  await f.create({ kind: 'media', bucket: 'horse-media', horseId: 'horse-a' });
  await assert.rejects(f.create({ kind: 'media', bucket: 'horse-media', horseId: 'horse-b' }), {
    code: 'upload_request_conflict',
  });
});

test('storage control retains its exact external path without increasing the twelve-function surface', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.deepEqual(
    config.rewrites.find((r) => r.source === '/api/storage/uploads'),
    { source: '/api/storage/uploads', destination: '/api/documents/storage-uploads' },
  );
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.name.startsWith('_')
        ? []
        : entry.isDirectory()
          ? walk(`${dir}/${entry.name}`)
          : entry.name.endsWith('.js')
            ? [`${dir}/${entry.name}`]
            : [],
    );
  assert.equal(walk('api').length, 12);
  assert.equal(documentConfig.api.bodyParser, false);
});
for (const [path, query, expected] of [
  ['/api/storage/uploads', {}, 'workspace'],
  ['/api/storage/uploads', { action: 'storage-uploads' }, 'workspace'],
  ['/api/storage/uploads', { action: 'bulk-upload-with-ocr' }, 'valid workspace'],
  ['/api/documents/storage-uploads', { action: 'generate-from-template' }, 'valid workspace'],
  ['/api/documents/storage-uploads', {}, 'workspace'],
  ['/api/documents/generate-from-template', {}, 'templateId'],
  ['/api/documents/bulk-upload-with-ocr', {}, 'workspaceId'],
])
  test(`raw JSON parsing and dispatch remain intact: ${path} ${JSON.stringify(query)}`, async () => {
    const req = Readable.from(['{', '}']);
    req.method = 'POST';
    req.url = path;
    req.query = query;
    req.headers = { 'content-type': 'application/json', 'x-real-ip': path + JSON.stringify(query) };
    let response;
    await documentRouter(req, {
      setHeader() {},
      end(value) {
        response = { status: this.statusCode, body: JSON.parse(value) };
      },
    });
    assert.equal(response.status, 400);
    assert.match(response.body.message, new RegExp(expected, 'i'));
  });

test('ListParts exhausts every provider page; pagination loops fail closed', async () => {
  const calls = [];
  const pages = [
    { Parts: [{ PartNumber: 1, Size: UPLOAD_PART_SIZE, ETag: 'a' }], IsTruncated: true, NextPartNumberMarker: '1' },
    { Parts: [{ PartNumber: 2, Size: 7, ETag: 'b' }], IsTruncated: false },
  ];
  const transport = storageTransportForClient({
    async send(command) {
      calls.push(command.input);
      return pages.shift();
    },
  });
  const parts = await transport.listParts({
    bucket_id: 'horse-documents',
    object_path: 'key',
    provider_upload_id: 'provider',
  });
  assert.equal(parts.length, 2);
  assert.equal(calls[1].PartNumberMarker, '1');
  const invalid = storageTransportForClient({
    async send() {
      return { Parts: [], IsTruncated: true, NextPartNumberMarker: '1' };
    },
  });
  await assert.rejects(invalid.listParts({}), /Incomplete multipart inventory/);
});
test('provider 403 and unknown HEAD outcomes never become absent-object proof', async () => {
  for (const name of ['AccessDenied', 'TimeoutError', 'InternalError']) {
    const transport = storageTransportForClient({
      async send() {
        throw Object.assign(Error('private provider detail'), { name });
      },
    });
    await assert.rejects(transport.head({ bucket_id: 'b', object_path: 'key' }), { name });
    await assert.rejects(transport.abort({ bucket_id: 'b', object_path: 'key', provider_upload_id: 'p' }), { name });
  }
});
test('an unconfirmed part inventory preserves charge but status safely releases only verification', async () => {
  const f = fixture({
    list: async () => {
      throw Error('private provider error');
    },
  });
  await assert.rejects(f.service.complete(await f.create()), { code: 'upload_pending' });
  assert.equal(f.rows.get(ID).claim_action, 'verify');
  assert.equal((await f.service.status(await f.service.read(ID))).state, 'uploading');
  assert.equal(
    f.calls.some((x) => Array.isArray(x) && x[0] === 'complete'),
    false,
  );
});
test('database settlement failure cannot turn a measured object into unverified success', async () => {
  const f = fixture({ rpcError: 'xbar_settle_upload_stored' });
  await assert.rejects(f.service.complete(await f.create()), { code: 'upload_pending' });
  assert.equal(f.rows.get(ID).state, 'reconcile');
  assert.equal(f.calls.includes('abort'), false);
});
test('role downgrade denies existing upload parts before signing', async () => {
  const f = fixture();
  await f.create();
  const service = createUploadService({ ...f.access, role: 'Viewer' }, f.transport);
  await assert.rejects(service.read(ID), { code: 'capability_required' });
  assert.equal(f.calls.some(Array.isArray), false);
});

test('media horse path sanitizer matches the canonical client contract for odd identifiers', async () => {
  const source = readFileSync('src/lib/documentStoragePath.ts', 'utf8');
  const body = /export function sanitizeDocumentPathSegment[^]*?\{([^]*?)\n\}/.exec(source)?.[1];
  assert.ok(body);
  const clientSanitize = new Function('value', 'fallback', body);
  for (const horseId of [
    'Horse_ID.With spaces',
    'ABC--XYZ',
    '/../../',
    'Été🐴',
    'A'.repeat(90) + 'tail',
    'horse-' + ID,
  ]) {
    assert.equal(mediaHorseSegment(horseId), clientSanitize(horseId, 'record'));
    const f = fixture();
    const row = await f.create({ kind: 'media', bucket: 'horse-media', horseId });
    assert.equal(row.object_path.split('/')[2], clientSanitize(horseId, 'record'));
  }
});

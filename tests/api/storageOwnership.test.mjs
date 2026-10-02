/*
 * The server never reads a stored file on a caller's behalf that the caller
 * could not read themselves.
 *
 * Export and sale-packet assembly sign or download object paths recorded on
 * `documents.storage_path` and `sale_packets.packet_pdf_path` with the SERVICE
 * ROLE, which bypasses Storage RLS entirely. Both columns are writable by any
 * workspace manager. So a manager of workspace B could point one of B's rows at
 * workspace A's object and have the server sign it for them — the audit's F02:
 * a private document crossing customer boundaries through an editable pointer.
 *
 * The rule, shared with the upload intake guard (`mayUseClientStoragePath`):
 * a recorded path is read only when it is canonical (plain segments, no dot
 * segments, no `%` or `\`) and its first segment is the caller's workspace.
 * The prefix alone is not enough: Storage requests travel as URLs, and the URL
 * parser resolves `B/../A/x` (and its encoded spellings) to workspace A's
 * object. There is no uploader-keyed exception; that layout let a member's
 * files from another workspace into this one's exports. A refused file is
 * reported as refused and audited, never silently dropped.
 *
 * Drives the real api/_lib/horses-export.js and the packet-list path of
 * api/sale-packets.js through a scripted Supabase client.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { register } from 'node:module';

process.env.SUPABASE_URL = 'https://storage-owner-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';

register(new URL('./fixtures/billingLoader.mjs', import.meta.url));
const { __setBillingSupabase } = await import('./fixtures/billingSupabaseStub.mjs');
const { default: exportHandler } = await import('../../api/_lib/horses-export.js');
const { default: packetsHandler } = await import('../../api/sale-packets.js');
const {
  isWorkspaceObjectPath,
  mayUseClientStoragePath,
  RECORDED_FILE_MISSING,
  RECORDED_FILE_TEMPORARILY_UNAVAILABLE,
  RECORDED_PATH_REFUSED,
  PACKET_PATH_REFUSED,
} = await import('../../api/_lib/document-storage.js');
const { selectPacketDocuments } = await import('../../api/_lib/packet-selection.js');

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const CALLER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class Query {
  constructor(result) {
    this.result = result;
  }
  select() {
    return this;
  }
  eq() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  insert(row) {
    this.onInsert?.(row);
    return this;
  }
  maybeSingle() {
    const row = Array.isArray(this.result) ? (this.result[0] ?? null) : this.result;
    return Promise.resolve({ data: row, error: null });
  }
  then(resolve, reject) {
    return Promise.resolve({ data: this.result, error: null }).then(resolve, reject);
  }
}

function install({ documents = [], packets = [], missing = [], signError = null } = {}) {
  const signed = [];
  const audits = [];
  __setBillingSupabase({
    auth: {
      getUser: async (token) =>
        token === 'token-caller'
          ? { data: { user: { id: CALLER, email: 'owner@example.com' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
    },
    from(table) {
      const rows = {
        workspaces: { id: WORKSPACE, owner_user_id: CALLER },
        horses: { horse_id: 'horse-1', workspace_id: WORKSPACE, name: 'Bella' },
        documents,
        sale_packets: packets,
        ownership_records: [],
        reminders: [],
        audit_logs: [],
      }[table];
      if (rows === undefined) throw new Error(`unexpected table ${table}`);
      const query = new Query(rows);
      if (table === 'audit_logs') query.onInsert = (row) => audits.push(row);
      return query;
    },
    storage: {
      from: (bucket) => ({
        createSignedUrl: async () => {
          throw new Error('recorded paths are signed in one batch through signRecordedObjects');
        },
        // Storage's batch signer answers per path; a missing object comes back
        // with an error and no usable URL.
        createSignedUrls: async (paths) => {
          if (signError) return { data: null, error: signError };
          return {
            data: paths.map((path) => {
              signed.push(`${bucket}:${path}`);
              return missing.includes(path)
                ? { path, signedUrl: '', error: 'Object not found' }
                : { path, signedUrl: `https://signed.example/${bucket}/${path}`, error: null };
            }),
            error: null,
          };
        },
      }),
    },
  });
  return { signed, audits };
}

let requestCount = 0;
function call(handler, url) {
  requestCount += 1;
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = url;
  req.headers = {
    authorization: 'Bearer token-caller',
    host: 'localhost',
    // A fresh client address per request keeps the per-IP limiter out of it.
    'x-forwarded-for': `10.0.0.${requestCount}`,
  };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      end(payload) {
        resolve({ statusCode: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    void handler(req, res);
  });
}

const exportUrl = `/api/horses/export?workspaceId=${WORKSPACE}&horseId=horse-1`;
const doc = (documentId, storagePath) => ({ document_id: documentId, title: documentId, storage_path: storagePath });
const packet = (packetId, path) => ({ packet_id: packetId, horse_id: 'horse-1', packet_pdf_path: path });

// Every spelling a URL parser resolves out of workspace WORKSPACE into
// OTHER_WORKSPACE, plus other shapes XBAR never writes. Each starts with the
// caller's workspace id, so a first-segment check alone would pass all of them.
const ESCAPES = [
  `${WORKSPACE}/../${OTHER_WORKSPACE}/documents/horse-9/coggins.pdf`,
  `${WORKSPACE}/%2e%2e/${OTHER_WORKSPACE}/documents/horse-9/coggins.pdf`,
  `${WORKSPACE}/%2E%2E/${OTHER_WORKSPACE}/documents/horse-9/coggins.pdf`,
  `${WORKSPACE}/.%2E/${OTHER_WORKSPACE}/documents/horse-9/coggins.pdf`,
  `${WORKSPACE}/..%2f${OTHER_WORKSPACE}/documents/horse-9/coggins.pdf`,
  `${WORKSPACE}/..\\${OTHER_WORKSPACE}/documents/horse-9/coggins.pdf`,
  `${WORKSPACE}/./documents/horse-1/coggins.pdf`,
  `${WORKSPACE}/documents//coggins.pdf`,
  `${WORKSPACE}/documents/.hidden.pdf`,
  `${WORKSPACE}/documents/horse 1/coggins.pdf`,
  `${WORKSPACE}`,
  `${WORKSPACE}/`,
  `/${WORKSPACE}/documents/coggins.pdf`,
];

test("export does not sign another workspace's document named in this workspace's row, and audits it", async () => {
  const foreign = `${OTHER_WORKSPACE}/documents/horse-9/coggins.pdf`;
  const { signed, audits } = install({ documents: [doc('forged', foreign)] });

  const response = await call(exportHandler, exportUrl);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(signed, [], 'the foreign object was signed');
  const [exported] = response.body.documents;
  assert.equal(exported.downloadUrl, '');
  assert.equal(exported.downloadUnavailable, RECORDED_PATH_REFUSED, 'refused, and said so');
  const refusal = audits.find((row) => row.action === 'storage.path_refused');
  assert.ok(refusal, 'a refused path is audited');
  assert.equal(refusal.workspace_id, WORKSPACE);
  assert.deepEqual(refusal.metadata.rows, ['document:forged']);
});

test('export refuses every path that would resolve out of the workspace, however it is spelled', async () => {
  const documents = ESCAPES.map((path, index) => doc(`escape-${index}`, path));
  const { signed } = install({ documents });

  const response = await call(exportHandler, exportUrl);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(signed, [], 'a non-canonical path reached the signer');
  for (const exported of response.body.documents) {
    assert.equal(exported.downloadUrl, '', exported.documentId);
    assert.equal(exported.downloadUnavailable, RECORDED_PATH_REFUSED, exported.documentId);
  }
});

test("export does not sign a pre-migration uploader-keyed path, even the caller's own", async () => {
  const theirs = `${OTHER_USER}/documents/horse-9/coggins.pdf`;
  const mine = `${CALLER}/documents/horse-1/old-cvi.pdf`;
  const { signed } = install({ documents: [doc('theirs', theirs), doc('mine', mine)] });

  const response = await call(exportHandler, exportUrl);

  assert.deepEqual(signed, []);
  for (const exported of response.body.documents) {
    assert.equal(exported.downloadUrl, '');
    assert.equal(exported.downloadUnavailable, RECORDED_PATH_REFUSED);
  }
});

test("export signs the workspace's own documents, and says which have no file or a missing one", async () => {
  const own = `${WORKSPACE}/documents/horse-1/coggins.pdf`;
  const upper = `${WORKSPACE.toUpperCase()}/documents/horse-1/cvi.v2.pdf`;
  const gone = `${WORKSPACE}/documents/horse-1/deleted.pdf`;
  const { signed, audits } = install({
    documents: [doc('own', own), doc('upper', upper), doc('gone', gone), doc('none', null)],
    missing: [gone],
  });

  const response = await call(exportHandler, exportUrl);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(signed, [`horse-documents:${own}`, `horse-documents:${upper}`, `horse-documents:${gone}`]);
  const byId = Object.fromEntries(response.body.documents.map((entry) => [entry.documentId, entry]));
  assert.ok(byId.own.downloadUrl);
  assert.equal(byId.own.downloadUnavailable, undefined);
  assert.ok(byId.upper.downloadUrl);
  assert.equal(byId.gone.downloadUrl, '');
  assert.equal(byId.gone.downloadUnavailable, RECORDED_FILE_MISSING, 'a missing object is said, not blank');
  assert.equal(byId.none.downloadUrl, '');
  assert.match(byId.none.downloadUnavailable, /No file is attached/);
  assert.equal(
    audits.filter((row) => row.action === 'storage.path_refused').length,
    0,
    'nothing was refused, so nothing is audited as refused',
  );
});

test('a storage outage is reported as temporary, not as files to re-upload', async () => {
  // Telling a seller every file "could not be found" during an outage has them
  // duplicate uploads and packets for files that exist.
  const own = `${WORKSPACE}/documents/horse-1/coggins.pdf`;
  install({
    documents: [doc('own', own)],
    packets: [packet('p', `${WORKSPACE}/horse-1/p.pdf`)],
    signError: { message: 'storage down' },
  });

  const response = await call(exportHandler, exportUrl);

  assert.equal(response.statusCode, 200);
  const [exported] = response.body.documents;
  assert.equal(exported.downloadUrl, '');
  assert.equal(exported.downloadUnavailable, RECORDED_FILE_TEMPORARILY_UNAVAILABLE);
  assert.doesNotMatch(exported.downloadUnavailable, /re-upload it/i);
  assert.equal(response.body.salePackets[0].downloadUnavailable, RECORDED_FILE_TEMPORARILY_UNAVAILABLE);
});

test('a signer that throws is the same outage, not a crash', async () => {
  const { signRecordedObjects } = await import('../../api/_lib/document-storage.js');
  const throwing = {
    storage: {
      from: () => ({
        createSignedUrls: async () => {
          throw new Error('network');
        },
      }),
    },
  };
  const [result] = await signRecordedObjects({
    supabase: throwing,
    bucket: 'b',
    paths: [`${WORKSPACE}/documents/x/f.pdf`],
    workspaceId: WORKSPACE,
    ttlSeconds: 60,
  });
  assert.deepEqual(result, { unavailable: RECORDED_FILE_TEMPORARILY_UNAVAILABLE });
});

test("export does not sign a packet path outside this workspace, and signs the workspace's own", async () => {
  const own = `${WORKSPACE}/horse-1/packet-1.pdf`;
  const foreign = `${OTHER_WORKSPACE}/horse-9/packet-9.pdf`;
  const climbing = `${WORKSPACE}/%2e%2e/${OTHER_WORKSPACE}/horse-9/packet-9.pdf`;
  const { signed, audits } = install({
    packets: [packet('own', own), packet('forged', foreign), packet('climbing', climbing), packet('unbuilt', '')],
  });

  const response = await call(exportHandler, exportUrl);

  assert.deepEqual(signed, [`sale-packets:${own}`]);
  const byId = Object.fromEntries(response.body.salePackets.map((entry) => [entry.packetId, entry]));
  assert.ok(byId.own.downloadUrl);
  assert.equal(byId.forged.downloadUrl, '');
  assert.equal(byId.forged.downloadUnavailable, PACKET_PATH_REFUSED);
  assert.equal(byId.climbing.downloadUnavailable, PACKET_PATH_REFUSED);
  assert.match(byId.unbuilt.downloadUnavailable, /No PDF is stored/);
  const refusal = audits.find((row) => row.action === 'storage.path_refused');
  assert.deepEqual(refusal.metadata.rows, ['packet:forged', 'packet:climbing']);
});

test('the saved-packet list does not sign a packet path outside this workspace', async () => {
  const own = `${WORKSPACE}/horse-1/packet-1.pdf`;
  const foreign = `${OTHER_WORKSPACE}/horse-9/packet-9.pdf`;
  const climbing = `${WORKSPACE}/../${OTHER_WORKSPACE}/horse-9/packet-9.pdf`;
  const { signed, audits } = install({
    packets: [packet('own', own), packet('forged', foreign), packet('climbing', climbing), packet('unbuilt', null)],
  });

  const response = await call(packetsHandler, `/api/sale-packets?workspaceId=${WORKSPACE}`);

  const refusal = audits.find((row) => row.action === 'storage.path_refused');
  assert.ok(refusal, 'a refused packet path in the list is audited, like the export');
  assert.deepEqual(refusal.metadata.rows, ['packet:forged', 'packet:climbing']);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(signed, [`sale-packets:${own}`]);
  const byId = Object.fromEntries(response.body.packets.map((entry) => [entry.packetId, entry]));
  assert.ok(byId.own.downloadUrl);
  assert.equal(byId.forged.downloadUrl, '');
  assert.equal(byId.forged.downloadUnavailable, PACKET_PATH_REFUSED);
  assert.equal(byId.climbing.downloadUnavailable, PACKET_PATH_REFUSED);
  assert.match(byId.unbuilt.downloadUnavailable, /No PDF is stored/);
});

test('a recorded path belongs to a workspace only in canonical form under that workspace', () => {
  for (const check of [
    (path, workspaceId) => isWorkspaceObjectPath({ path, workspaceId }),
    (path, workspaceId) => mayUseClientStoragePath({ storagePath: path, workspaceId }),
  ]) {
    assert.equal(check(`${WORKSPACE}/horse-1/p.pdf`, WORKSPACE), true);
    assert.equal(check(`${WORKSPACE.toUpperCase()}/horse-1/p.pdf`, WORKSPACE), true);
    assert.equal(check(`${WORKSPACE}/documents/doc-1/coggins_2024.v2.pdf`, WORKSPACE), true);
    for (const refused of [
      ...ESCAPES,
      `${OTHER_WORKSPACE}/horse-1/p.pdf`,
      `${CALLER}/horse-1/p.pdf`,
      `${WORKSPACE}/${'a'.repeat(1100)}.pdf`,
      '',
      null,
      undefined,
      42,
    ]) {
      assert.equal(check(refused, WORKSPACE), false, `${String(refused).slice(0, 80)} was allowed`);
    }
    // No workspace, or a workspace id that is not one, matches nothing.
    assert.equal(check(`${WORKSPACE}/p.pdf`, ''), false);
    assert.equal(check('horse-1/p.pdf', 'horse-1'), false);
    assert.equal(check(`${WORKSPACE}/p.pdf`, undefined), false);
  }
});

test('packet assembly names a refused file before the cap, so it never takes a real file’s slot', () => {
  const own = (id) => ({ document_id: id, title: id, storage_path: `${WORKSPACE}/documents/${id}/f.pdf` });
  const forged = { document_id: 'forged', title: 'Forged', storage_path: `${OTHER_WORKSPACE}/documents/x/f.pdf` };
  const refused = [];
  const refuse = (doc) => {
    if (mayUseClientStoragePath({ storagePath: doc.storage_path, workspaceId: WORKSPACE })) return null;
    refused.push(doc.document_id);
    return 'file unavailable';
  };

  const { packetDocs, unavailable } = selectPacketDocuments([forged, own('a'), own('b'), own('c')], [], 2, { refuse });

  assert.deepEqual(
    packetDocs.map((d) => d.document_id),
    ['a', 'b'],
    'the forged row must not consume a slot',
  );
  assert.deepEqual(refused, ['forged']);
  assert.deepEqual(unavailable, ['Forged (file unavailable)', 'c (over the 2-document packet limit)']);
});

test('packet assembly without a refuse rule keeps its earlier selection behaviour', () => {
  const docs = [
    { document_id: 'a', title: 'A', storage_path: `${WORKSPACE}/documents/a/f.pdf` },
    { document_id: 'b', title: 'B', storage_path: '' },
  ];
  const { packetDocs } = selectPacketDocuments(docs, [], 20);
  assert.deepEqual(
    packetDocs.map((d) => d.document_id),
    ['a'],
  );
});

test('packet assembly wires the workspace rule into selection, ahead of every service-role download', async () => {
  // Driving POST end to end needs entitlements, sealing and PDF assembly; the
  // selection rule itself is exercised above. This pins that the handler
  // actually applies it, and that the only download reads selected documents.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../api/sale-packets.js', import.meta.url), 'utf8');
  const select = source.indexOf('selectPacketDocuments(loaded.documents');
  const rule = source.indexOf('isWorkspaceObjectPath({ path: doc.storage_path, workspaceId })');
  const download = source.indexOf('.download(doc.storage_path)');
  assert.ok(select > -1 && rule > select, 'selection no longer applies the workspace rule');
  assert.ok(download > rule, 'a download now happens before the rule');
  assert.equal(source.split('.download(').length - 1, 1, 'a second service-role download was added; guard it');
  assert.match(source.slice(select, download), /for \(const doc of packetDocs\)/);
});

test('every path the server writes passes the rule it reads with', async () => {
  // A writer that can emit a path its own reader refuses turns a good file into
  // a "not stored in this workspace" refusal and a false audit row. Reproduced
  // with a long name whose 80-character tail began with a dot.
  const { documentObjectPath, isWorkspaceObjectPath, safeDocumentSegment } =
    await import('../../api/_lib/document-storage.js');
  const hostile = [
    `${'a'.repeat(25)}.${'y'.repeat(79)}`,
    `${'b'.repeat(200)}..${'z'.repeat(79)}.pdf`,
    '...',
    '.hidden.pdf',
    '../../etc/passwd',
    '..\\..\\x',
    '%2e%2e/%2e%2e',
    'Bill of Sale (final).PDF',
    'ñandú.jpg',
    '',
    ' ',
  ];
  for (const name of hostile) {
    const documentPath = documentObjectPath({ workspaceId: WORKSPACE, documentId: name, fileName: name });
    assert.ok(isWorkspaceObjectPath({ path: documentPath, workspaceId: WORKSPACE }), `document path ${documentPath}`);
    // The packet writer: `${workspaceId}/${safeDocumentSegment(horseId, 'horse')}/${packetId}.pdf`.
    const packetPath = `${WORKSPACE}/${safeDocumentSegment(name, 'horse')}/packet-1.pdf`;
    assert.ok(isWorkspaceObjectPath({ path: packetPath, workspaceId: WORKSPACE }), `packet path ${packetPath}`);
  }
});

test('export reads a file recorded only in the synced payload, like packet assembly does', async () => {
  // Rows written by the app's mirror keep the path in payload.storagePath and
  // leave the column empty. Reading only the column reported "No file is
  // attached" for a file that exists and that sale packets include.
  const own = `${WORKSPACE}/documents/horse-1/coggins.pdf`;
  const { signed } = install({
    documents: [{ document_id: 'mirrored', title: 'Coggins', storage_path: '', payload: { storagePath: own } }],
  });

  const response = await call(exportHandler, exportUrl);

  assert.deepEqual(signed, [`horse-documents:${own}`]);
  const [exported] = response.body.documents;
  assert.ok(exported.downloadUrl);
  assert.equal(exported.downloadUnavailable, undefined);
});

test('the photo uploader files under the batch workspace, only for the account that started it', async () => {
  // The store module uses Vite's @/ alias and cannot run under node, so the
  // call sites are pinned from source (see CLAUDE.md, repo notes).
  const { readFile } = await import('node:fs/promises');
  const uploader = await readFile(new URL('../../src/lib/cloudWorkspace.ts', import.meta.url), 'utf8');
  const start = uploader.indexOf('export async function uploadMediaAssetToCloud(');
  const body = uploader.slice(start, uploader.indexOf('\n}\n', start));
  assert.match(body, /target: IntakeIdentity/);
  assert.match(body, /!isWorkspaceStorageKey\(target\.workspaceId\) \|\| session\.user\.id !== target\.userId/);
  assert.match(body, /buildMediaStoragePath\(\{\s*workspaceId: target\.workspaceId,/);
  assert.match(body, /if \(!path\) \{\s*return null;/);
  // One workspace lookup per batch, not one per file.
  assert.ok(!body.includes('loadWorkspaceAccessProfile('), 'the uploader re-resolves the workspace per file');

  const store = await readFile(new URL('../../src/store/useXbarStore.ts', import.meta.url), 'utf8');
  const media = store.slice(store.indexOf('uploadHorseMedia: async'));
  const resolved = media.indexOf('const uploadTarget = readIntakeIdentity();');
  const notReady = media.indexOf('if (uploadTarget.userId && !uploadTarget.workspaceId)');
  const uploads = media.indexOf('uploadMediaAssetToCloud({ file, horseId, target: uploadTarget })');
  const recheck = media.indexOf('if (photoBatchIdentityChanged(uploadTarget, readIntakeIdentity()))');
  const commit = media.indexOf('const uploadedResults = results.filter');
  assert.ok(resolved > -1 && notReady > resolved && uploads > notReady, 'resolve once, refuse honestly, then upload');
  assert.ok(recheck > uploads && commit > recheck, 'the account is re-checked before photos are attached');
  const refusal = media.slice(notReady, uploads);
  assert.match(refusal, /isRelationalCloudEnabled\(\)/, 'a build with workspace sync off must be told so');
  assert.match(refusal, /has not connected your ranch workspace yet/);
  assert.match(refusal, /turned off in this build/);
});

test('export says a device-only document is on the device, not that it has no file', async () => {
  install({
    documents: [
      { document_id: 'vault', title: 'Coggins', storage_path: '', payload: { localFileKey: 'local-1' } },
      { document_id: 'none', title: 'Notes', storage_path: '', payload: {} },
    ],
  });

  const response = await call(exportHandler, exportUrl);

  const byId = Object.fromEntries(response.body.documents.map((entry) => [entry.documentId, entry]));
  assert.match(byId.vault.downloadUnavailable, /saved only on the device it was added from/);
  assert.match(byId.none.downloadUnavailable, /No file is attached/);
});

test('every photo path the client builds is one the server will sign for that workspace', async () => {
  // The client and server sit in different modules; this drives the client's
  // path builder (compiled by the test run) against the server's own check.
  const { buildMediaStoragePath } = await import('../../.codex-test-dist/src/lib/documentStoragePath.js');
  const { isHorseMediaStoragePath } = await import('../../api/_lib/buyer-media.js');
  const hostile = [
    'horse-1',
    'Bella Rose',
    '../../etc',
    '.hidden',
    '%2e%2e',
    'a/b',
    '',
    '   ',
    'ñandú',
    'x'.repeat(200),
  ];
  for (const horseId of hostile) {
    for (const objectId of ['media-123-abc', 'media_UPPER.1', '', '..', 'not-prefixed']) {
      for (const originalFileName of ['photo.JPG', 'no-extension', 'evil.tar/../../x', '.jpg', 'a.b.c.png']) {
        const path = buildMediaStoragePath({
          workspaceId: WORKSPACE.toUpperCase(),
          horseId,
          objectId,
          originalFileName,
        });
        assert.ok(isHorseMediaStoragePath(path), `the server would refuse ${path}`);
        assert.ok(isWorkspaceObjectPath({ path, workspaceId: WORKSPACE }), `${path} is not under the workspace`);
      }
    }
  }
  assert.equal(
    buildMediaStoragePath({ workspaceId: '', horseId: 'h', objectId: 'media-1', originalFileName: 'a.jpg' }),
    null,
  );
  assert.equal(
    buildMediaStoragePath({ workspaceId: 'not-a-uuid', horseId: 'h', objectId: 'media-1', originalFileName: 'a.jpg' }),
    null,
  );
});

test('a refused packet is told to be rebuilt, never re-uploaded', () => {
  // Packets are server-built: there is no upload path for one.
  assert.match(PACKET_PATH_REFUSED, /Build the packet again/);
  assert.doesNotMatch(PACKET_PATH_REFUSED, /re-upload/i);
});

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
 * a recorded document path is read only when the database would have let the
 * caller read it with their own token — an object under the caller's
 * workspace, or the caller's own pre-migration uploader-keyed object. Packet
 * PDFs are only ever written by the server, under the workspace, so nothing
 * else is accepted for them. A refused file is reported as refused, not
 * silently dropped.
 *
 * Drives the real api/_lib/horses-export.js and the packet-list path of
 * api/sale-packets.js through a scripted Supabase client.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { register } from 'node:module';

process.env.SUPABASE_URL = 'https://storage-owner-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';

register(new URL('./fixtures/billingLoader.mjs', import.meta.url));
const { __setBillingSupabase } = await import('./fixtures/billingSupabaseStub.mjs');
const { default: exportHandler } = await import('../../api/_lib/horses-export.js');
const { default: packetsHandler } = await import('../../api/sale-packets.js');
const { mayReadPacketPath } = await import('../../api/_lib/document-storage.js');

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
  insert() {
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

function install({ documents = [], packets = [] } = {}) {
  const signed = [];
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
      return new Query(rows);
    },
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (path) => {
          signed.push(`${bucket}:${path}`);
          return { data: { signedUrl: `https://signed.example/${bucket}/${path}` }, error: null };
        },
      }),
    },
  });
  return signed;
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

test("export does not sign another workspace's document named in this workspace's row, as reviewed", async () => {
  const foreign = `${OTHER_WORKSPACE}/documents/horse-9/coggins.pdf`;
  const signed = install({ documents: [doc('forged', foreign)] });

  const response = await call(exportHandler, exportUrl);

  assert.equal(response.statusCode, 200);
  assert.ok(!signed.some((entry) => entry.endsWith(foreign)), 'the foreign object was signed');
  const [exported] = response.body.documents;
  assert.equal(exported.downloadUrl, '');
  assert.match(exported.downloadUnavailable, /does not belong to this workspace/, 'refused, and said so');
});

test("export does not sign another user's pre-migration upload", async () => {
  const theirs = `${OTHER_USER}/documents/horse-9/coggins.pdf`;
  const signed = install({ documents: [doc('theirs', theirs)] });

  const response = await call(exportHandler, exportUrl);

  assert.ok(!signed.some((entry) => entry.endsWith(theirs)));
  assert.equal(response.body.documents[0].downloadUrl, '');
});

test("export still signs the workspace's own documents and the caller's own older uploads", async () => {
  const own = `${WORKSPACE}/documents/horse-1/coggins.pdf`;
  const legacy = `${CALLER}/documents/horse-1/old-cvi.pdf`;
  const signed = install({ documents: [doc('own', own), doc('legacy', legacy)] });

  const response = await call(exportHandler, exportUrl);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(signed, [`horse-documents:${own}`, `horse-documents:${legacy}`]);
  for (const exported of response.body.documents) {
    assert.ok(exported.downloadUrl, `${exported.documentId} lost its download`);
    assert.equal(exported.downloadUnavailable, undefined);
  }
});

test("export does not sign a packet path outside this workspace, and signs the workspace's own", async () => {
  const own = `${WORKSPACE}/horse-1/packet-1.pdf`;
  const foreign = `${OTHER_WORKSPACE}/horse-9/packet-9.pdf`;
  const signed = install({ packets: [packet('own', own), packet('forged', foreign)] });

  const response = await call(exportHandler, exportUrl);

  assert.deepEqual(signed, [`sale-packets:${own}`]);
  const byId = Object.fromEntries(response.body.salePackets.map((entry) => [entry.packetId, entry]));
  assert.ok(byId.own.downloadUrl);
  assert.equal(byId.forged.downloadUrl, '');
  assert.match(byId.forged.downloadUnavailable, /does not belong to this workspace/);
});

test('the saved-packet list does not sign a packet path outside this workspace', async () => {
  const own = `${WORKSPACE}/horse-1/packet-1.pdf`;
  const foreign = `${OTHER_WORKSPACE}/horse-9/packet-9.pdf`;
  const signed = install({ packets: [packet('own', own), packet('forged', foreign)] });

  const response = await call(packetsHandler, `/api/sale-packets?workspaceId=${WORKSPACE}`);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(signed, [`sale-packets:${own}`]);
  const forged = response.body.packets.find((entry) => entry.packetId === 'forged');
  assert.equal(forged.downloadUrl, '');
  assert.match(forged.downloadUnavailable, /does not belong to this workspace/);
});

test('a packet path belongs to a workspace only under that workspace, with nothing to climb out of it', () => {
  const allowed = { workspaceId: WORKSPACE };
  assert.equal(mayReadPacketPath({ packetPath: `${WORKSPACE}/horse-1/p.pdf`, ...allowed }), true);
  assert.equal(mayReadPacketPath({ packetPath: `${WORKSPACE.toUpperCase()}/horse-1/p.pdf`, ...allowed }), true);
  for (const refused of [
    `${OTHER_WORKSPACE}/horse-1/p.pdf`,
    `${CALLER}/horse-1/p.pdf`,
    `${WORKSPACE}/../${OTHER_WORKSPACE}/p.pdf`,
    `/${WORKSPACE}/p.pdf`,
    '',
    null,
  ]) {
    assert.equal(mayReadPacketPath({ packetPath: refused, ...allowed }), false, `${refused} was allowed`);
  }
  assert.equal(mayReadPacketPath({ packetPath: `${WORKSPACE}/p.pdf`, workspaceId: '' }), false);
});

test('packet assembly checks a recorded document path before downloading it, as reviewed', () => {
  // The POST path assembles a PDF, seals it and uploads it before it responds,
  // so it is pinned by order here; the rule itself is mayUseClientStoragePath,
  // whose cases documentPipeline.test.mjs covers.
  const source = readFileSync('api/sale-packets.js', 'utf8');
  const guard = source.indexOf('mayUseClientStoragePath({ storagePath: doc.storage_path');
  const download = source.indexOf('.download(doc.storage_path)');
  assert.ok(guard > -1, 'the recorded path is never checked');
  assert.ok(download > -1, 'the assembly download moved; re-point this pin');
  assert.ok(guard < download, 'the check must come before the service-role download');
});

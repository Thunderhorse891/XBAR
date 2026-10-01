/*
 * A saved packet opens again after its first link expires — without being
 * rebuilt, and only for someone who can still read it.
 *
 * The link returned when a packet is built lives 72 hours, and the app used to
 * keep nothing else: both saved-packet lists linked straight to it, so on day
 * four the only way to send the packet again was to build — and pay for — a new
 * one. The audit's F10.
 *
 * `GET /api/sale-packets?packetId=` signs one stored packet again. It must:
 *   - answer with that packet only, freshly signed;
 *   - write nothing: no packet row, no upload, no usage;
 *   - refuse a caller who is not, or is no longer, in the workspace;
 *   - refuse a packet that is not recorded in the caller's workspace, including
 *     another workspace's packet asked for by its id.
 *
 * Drives the real api/sale-packets.js through a scripted Supabase client whose
 * `eq` filters actually filter, so a missing workspace or packet filter shows
 * up as a wrong answer rather than passing unnoticed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { register } from 'node:module';

process.env.SUPABASE_URL = 'https://packet-refresh-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';

register(new URL('./fixtures/billingLoader.mjs', import.meta.url));
const { __setBillingSupabase } = await import('./fixtures/billingSupabaseStub.mjs');
const { default: packetsHandler } = await import('../../api/sale-packets.js');

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REMOVED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OWN_PACKET = 'packet-0b0e4c2a-5d7f-4f7e-9c1a-2d3e4f5a6b7c';
const SECOND_PACKET = 'packet-1c1f5d3b-6e8a-4a8f-8d2b-3e4f5a6b7c8d';
const FOREIGN_PACKET = 'packet-2d2a6e4c-7f9b-4b9a-9e3c-4f5a6b7c8d9e';

const TOKENS = { 'token-owner': OWNER, 'token-member': MEMBER, 'token-removed': REMOVED };

const packetRow = (workspaceId, packetId) => ({
  workspace_id: workspaceId,
  packet_id: packetId,
  horse_id: 'horse-1',
  packet_pdf_path: `${workspaceId}/horse-1/${packetId}.pdf`,
  watermark_text: 'For Jane Buyer',
  shared_with_email: '',
  document_ids: [],
  status: 'ready',
  created_at: '2026-09-01T12:00:00Z',
});

class Query {
  constructor(table, rows, log) {
    this.table = table;
    this.allRows = rows;
    this.log = log;
    this.filters = [];
  }
  select() {
    return this;
  }
  eq(column, value) {
    this.filters.push([column, value]);
    this.log.filters.push(`${this.table}.${column}=${value}`);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  write(kind) {
    this.log.writes.push(`${kind} ${this.table}`);
    return this;
  }
  insert() {
    return this.write('insert');
  }
  upsert() {
    return this.write('upsert');
  }
  update() {
    return this.write('update');
  }
  delete() {
    return this.write('delete');
  }
  rows() {
    return this.allRows.filter((row) => this.filters.every(([column, value]) => row[column] === value));
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(resolve, reject) {
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
}

function install() {
  const log = { filters: [], writes: [], signed: [] };
  const tables = {
    workspaces: [
      { id: WORKSPACE, owner_user_id: OWNER },
      { id: OTHER_WORKSPACE, owner_user_id: REMOVED },
    ],
    // REMOVED used to be a member here; the row is gone, as a removal leaves it.
    workspace_memberships: [{ workspace_id: WORKSPACE, user_id: MEMBER, role: 'Viewer', status: 'active' }],
    sale_packets: [
      packetRow(WORKSPACE, OWN_PACKET),
      packetRow(WORKSPACE, SECOND_PACKET),
      packetRow(OTHER_WORKSPACE, FOREIGN_PACKET),
    ],
  };
  __setBillingSupabase({
    auth: {
      getUser: async (token) =>
        TOKENS[token]
          ? { data: { user: { id: TOKENS[token], email: 'someone@example.com' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
    },
    from(table) {
      const rows = tables[table];
      if (!rows) throw new Error(`unexpected table ${table}`);
      return new Query(table, rows, log);
    },
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (path, ttl) => {
          log.signed.push(`${bucket}:${path}`);
          return { data: { signedUrl: `https://signed.example/${bucket}/${path}?ttl=${ttl}` }, error: null };
        },
        upload: async (path) => {
          log.writes.push(`upload ${bucket}:${path}`);
          return { data: null, error: null };
        },
        remove: async (paths) => {
          log.writes.push(`remove ${bucket}:${paths}`);
          return { data: null, error: null };
        },
      }),
    },
  });
  return log;
}

function get(url, token) {
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = url;
  req.headers = { authorization: `Bearer ${token}`, host: 'localhost' };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      end(payload) {
        resolve({ statusCode: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    void packetsHandler(req, res);
  });
}

const refreshUrl = (packetId, workspaceId = WORKSPACE) =>
  `/api/sale-packets?workspaceId=${workspaceId}&packetId=${packetId}`;

test('a saved packet is signed again by its id, alone, with a fresh 72-hour link', async () => {
  const log = install();

  const response = await get(refreshUrl(OWN_PACKET), 'token-owner');

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.deepEqual(
    response.body.packets.map((packet) => packet.packetId),
    [OWN_PACKET],
    'only the packet that was asked for is answered',
  );
  const [packet] = response.body.packets;
  const path = `${WORKSPACE}/horse-1/${OWN_PACKET}.pdf`;
  assert.deepEqual(log.signed, [`sale-packets:${path}`], 'one signature, for the stored PDF');
  assert.equal(packet.downloadUrl, `https://signed.example/sale-packets/${path}?ttl=${72 * 3600}`);
  assert.equal(packet.expiresInSeconds, 72 * 3600);
  assert.ok(log.filters.includes(`sale_packets.workspace_id=${WORKSPACE}`));
  assert.ok(log.filters.includes(`sale_packets.packet_id=${OWN_PACKET}`));
});

test('re-signing writes nothing — no rebuild, no upload, no packet charged to the plan', async () => {
  const log = install();

  await get(refreshUrl(OWN_PACKET), 'token-owner');

  assert.deepEqual(log.writes, []);
});

test('a workspace member who can read packets can re-open one', async () => {
  const log = install();

  const response = await get(refreshUrl(SECOND_PACKET), 'token-member');

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.packets[0].packetId, SECOND_PACKET);
  assert.equal(log.signed.length, 1);
});

test('someone removed from the workspace gets no link', async () => {
  const log = install();

  const response = await get(refreshUrl(OWN_PACKET), 'token-removed');

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.ok, false);
  assert.deepEqual(log.signed, []);
  assert.ok(
    !log.filters.some((filter) => filter.startsWith('sale_packets.')),
    'packets were read for a refused caller',
  );
});

test('an unverifiable session gets no link', async () => {
  const log = install();

  const response = await get(refreshUrl(OWN_PACKET), 'token-forged');

  assert.equal(response.statusCode, 401);
  assert.deepEqual(log.signed, []);
});

test("another workspace's packet, asked for by its id, is not found here", async () => {
  const log = install();

  const response = await get(refreshUrl(FOREIGN_PACKET), 'token-owner');

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'packet_not_found');
  assert.match(response.body.message, /no longer stored in this workspace/);
  assert.deepEqual(log.signed, []);
});

test('a packet no longer recorded is refused, and says so', async () => {
  const log = install();

  const response = await get(refreshUrl('packet-00000000-0000-4000-8000-000000000000'), 'token-owner');

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, 'packet_not_found');
  assert.deepEqual(log.signed, []);
});

test('the list without a packet id is unchanged: every packet in the workspace, and only those', async () => {
  const log = install();

  const response = await get(`/api/sale-packets?workspaceId=${WORKSPACE}`, 'token-owner');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.packets.map((packet) => packet.packetId).sort(), [OWN_PACKET, SECOND_PACKET].sort());
  assert.ok(!log.filters.some((filter) => filter.startsWith('sale_packets.packet_id')));
});

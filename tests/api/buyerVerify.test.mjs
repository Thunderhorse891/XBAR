import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

import verifyHandler, { summarizeSealedPacket } from '../../api/_lib/buyer-verify.js';
import { buildServerSaleCredential } from '../../api/_lib/sale-credential.js';

/*
 * The public verify endpoint returns XBAR's stored server-anchored seal for a
 * packet so a buyer can confirm it is unaltered. summarizeSealedPacket is pure
 * and carries the logic; the handler adds CORS, rate limiting, lookup, and the
 * fail-safe posture (no service config -> no data leaves).
 */

function sealedRow() {
  const seal = buildServerSaleCredential({
    packetId: 'packet-xyz',
    horseId: 'horse-1',
    context: {
      horse: { name: 'Docs Smokin Gun', registry: 'AQHA', registrationNumber: 'X0099887', gender: 'Mare' },
      owner: { name: 'Rocking R Ranch LLC' },
      health: {},
      workspace: {},
    },
    ownershipRecord: { transfer_status: 'Clear' },
    documents: [{ document_id: 'doc-1', document_type: 'Coggins', title: 'Coggins 2026' }],
    sealedAt: '2026-08-06T12:00:00.000Z',
  });
  return { packet_id: 'packet-xyz', payload: { buyerName: 'Sam', seal }, created_at: '2026-08-06T12:00:00.000Z' };
}

test('summarizeSealedPacket reports not found for a missing row', () => {
  assert.deepEqual(summarizeSealedPacket(null), { found: false });
  assert.deepEqual(summarizeSealedPacket(undefined), { found: false });
});

test('summarizeSealedPacket reports unanchored when there is no server seal', () => {
  assert.deepEqual(summarizeSealedPacket({ payload: { buyerName: 'Sam' } }), { found: true, anchored: false });
  // A local (client) seal must not be treated as the server anchor.
  assert.deepEqual(summarizeSealedPacket({ payload: { seal: { anchor: 'local', digest: 'abc' } } }), {
    found: true,
    anchored: false,
  });
});

test('summarizeSealedPacket returns the seal and buyer-facing facts', () => {
  const summary = summarizeSealedPacket(sealedRow());
  assert.equal(summary.found, true);
  assert.equal(summary.anchored, true);
  assert.equal(summary.seal.anchor, 'server');
  assert.match(summary.seal.sealCode, /^SEAL-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.match(summary.seal.digest, /^[0-9a-f]{64}$/);
  assert.equal(summary.facts.horseName, 'Docs Smokin Gun');
  assert.equal(summary.facts.legalOwner, 'Rocking R Ranch LLC');
  assert.equal(summary.facts.transferStatus, 'Clear');
  assert.equal(summary.facts.registrationNumber, 'X0099887');
  assert.deepEqual(summary.facts.documents, [{ type: 'Coggins', title: 'Coggins 2026' }]);
});

test('summarizeSealedPacket tolerates a stringified jsonb payload', () => {
  const row = sealedRow();
  const stringified = { ...row, payload: JSON.stringify(row.payload) };
  const summary = summarizeSealedPacket(stringified);
  assert.equal(summary.anchored, true);
  assert.equal(summary.facts.horseName, 'Docs Smokin Gun');
});

// --- Handler gate/posture tests (no env configured) ------------------------

function invoke(handler, { method = 'GET', url = '/api/buyer/verify', query, body, headers = {} } = {}) {
  const req = body === undefined ? Readable.from([]) : Readable.from([JSON.stringify(body)]);
  req.method = method;
  // getQuery() parses req.url, mirroring how Vercel passes the full path+query,
  // so fold any query params into the url rather than only setting req.query.
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  req.url = `${url}${qs}`;
  req.headers = headers;
  if (query) req.query = query;
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value;
      },
      end(payload) {
        let parsed = null;
        try {
          parsed = payload ? JSON.parse(payload) : null;
        } catch {
          parsed = payload;
        }
        resolve({ status: this.statusCode, body: parsed });
      },
    };
    Promise.resolve(handler(req, res)).catch(() => resolve({ status: res.statusCode, body: null }));
  });
}

test('handler rejects unsupported methods', async () => {
  const { status } = await invoke(verifyHandler, { method: 'PUT' });
  assert.equal(status, 405);
});

test('handler requires a packetId', async () => {
  const { status, body } = await invoke(verifyHandler, { method: 'GET' });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
});

test('handler fails safe with 503 when the service is not configured', async () => {
  // No SUPABASE_SERVICE_ROLE_KEY in the test env -> getSupabaseAdmin returns null.
  const { status, body } = await invoke(verifyHandler, { method: 'GET', query: { packetId: 'packet-xyz' } });
  assert.equal(status, 503);
  assert.equal(body.ok, false);
});

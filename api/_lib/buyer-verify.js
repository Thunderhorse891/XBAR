import { sendJson, getQuery, readJsonBody } from './http.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { enforceRateLimit } from './rate-limit.js';
import { applyCors } from './cors.js';

/*
 * Public, anonymous packet verification.
 *
 *   GET  /api/buyer/verify?packetId=packet-...
 *   POST /api/buyer/verify   { packetId }
 *
 * A buyer holding a sale packet (and its printed seal code) can confirm the
 * packet against XBAR's OWN record. We look up the sale_packets row by its
 * unguessable packet id and return the server-anchored seal we computed and
 * stored at generation time, plus the buyer-facing facts it covers. Because the
 * seal was computed server-side from authoritative records — not from the
 * delivered bundle — a buyer comparing what XBAR sealed against the copy they
 * were sent will catch any alteration. This endpoint never returns the PDF, only
 * the seal and the facts under it.
 *
 * Anonymous by design, so it is per-IP rate limited.
 */

const RATE_LIMIT = { bucket: 'buyer-verify', limit: 30, windowSeconds: 60 };

/** Safely JSON-parse a value that may already be an object (Supabase jsonb) or a
 * string, returning null on anything unparseable. */
function asObject(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function str(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/**
 * Turn a stored sale_packets row into the buyer-facing verification result.
 * Pure and dependency-free so it can be unit-tested without a database.
 *
 *  - row is null / undefined         -> { found: false }
 *  - row has no server-anchored seal  -> { found: true, anchored: false }
 *  - row has a server seal            -> { found: true, anchored: true, seal, facts }
 *
 * `facts` are derived from the seal's own canonical payload (what was actually
 * hashed), so they always match the digest a buyer can recompute.
 */
export function summarizeSealedPacket(row) {
  if (!row) return { found: false };

  const payload = asObject(row.payload) || {};
  const seal = asObject(payload.seal);
  if (!seal || seal.anchor !== 'server' || !seal.digest) {
    // Packet exists but predates server anchoring, or was a local-only build.
    return { found: true, anchored: false };
  }

  const sealed = asObject(seal.payload) || {};
  const horse = asObject(sealed.horse) || {};
  const owner = asObject(sealed.owner) || {};
  const transfer = asObject(sealed.transfer) || {};
  const documents = Array.isArray(sealed.documents) ? sealed.documents : [];

  return {
    found: true,
    anchored: true,
    seal: {
      version: seal.version ?? 1,
      anchor: 'server',
      sealCode: str(seal.sealCode),
      digest: str(seal.digest),
      sealedAt: str(seal.sealedAt),
    },
    facts: {
      horseName: str(horse.name),
      barnName: str(horse.barnName),
      registry: str(horse.registry),
      registrationNumber: str(horse.registrationNumber),
      breed: str(horse.breed),
      sex: str(horse.gender),
      color: str(horse.color),
      legalOwner: str(owner.legalOwner),
      transferStatus: str(transfer.status),
      documents: documents.map((doc) => ({ type: str(doc.type), title: str(doc.title) })),
      sealedAt: str(seal.sealedAt),
    },
  };
}

function resolvePacketId(req) {
  const query = getQuery(req);
  return str(query.packetId).trim();
}

export default async function handler(req, res) {
  if (!applyCors(req, res, { methods: 'GET, POST, OPTIONS' })) {
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  if (!(await enforceRateLimit(req, res, RATE_LIMIT))) {
    return;
  }

  let packetId = resolvePacketId(req);
  if (!packetId && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Request body must be valid JSON.' });
    }
    packetId = str(body?.packetId).trim();
  }

  if (!packetId) {
    return sendJson(res, 400, { ok: false, message: 'A packetId is required to verify a packet.' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return sendJson(res, 503, { ok: false, message: 'The verification service is not configured.' });
  }

  const { data, error } = await supabase
    .from('sale_packets')
    .select('packet_id, payload, created_at')
    .eq('packet_id', packetId)
    .maybeSingle();

  if (error) {
    return sendJson(res, 502, { ok: false, message: 'Verification is temporarily unavailable. Try again.' });
  }

  const summary = summarizeSealedPacket(data);
  if (!summary.found) {
    return sendJson(res, 404, {
      ok: true,
      found: false,
      message: 'No packet with that code was found in XBAR’s records.',
    });
  }
  if (!summary.anchored) {
    return sendJson(res, 200, {
      ok: true,
      found: true,
      anchored: false,
      message: 'This packet exists but has no server-anchored seal on record. Ask the seller to regenerate it.',
    });
  }

  return sendJson(res, 200, {
    ok: true,
    found: true,
    anchored: true,
    seal: summary.seal,
    facts: summary.facts,
  });
}

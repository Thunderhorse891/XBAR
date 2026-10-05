import { isWorkspaceId } from './document-storage.js';
import { readJsonBody, sendJson } from './http.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { enforceRateLimit } from './rate-limit.js';
import { applyCors } from './cors.js';
import { BUYER_INQUIRY_KINDS, buyerInquirySchema, parseBody } from './validation.js';

/*
 * Public buyer folder intake. Anonymous buyers on a shared packet page can
 * ask a question, request a call or proof, submit an offer, or download the
 * buyer packet. The share path/token is validated against the listing (same
 * RPC the public page uses) before anything is written, and events land in
 * public_share_events where the workspace's buyer folder reads them.
 *
 * This endpoint is anonymous by design, so it is per-IP rate limited to stop a
 * single client from flooding a seller's buyer folder with spam events.
 */

const ALLOWED_KINDS = new Set(BUYER_INQUIRY_KINDS);
const RATE_LIMIT = { bucket: 'buyer-inquiries', limit: 12, windowSeconds: 60 };

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function consistentId(values, workspace = false) {
  const present = values.filter((value) => value !== undefined);
  if (!present.length || present.some((value) => typeof value !== 'string' || !value.trim())) return null;
  if (workspace && present.some((value) => !isWorkspaceId(value))) return null;
  const normalized = workspace ? present.map((value) => value.toLowerCase()) : present;
  return normalized.every((value) => value === normalized[0]) ? normalized[0] : null;
}

// Current RPC returns a nested selected-row envelope; older deployments returned
// one flat row. Never choose the first of several rows or mix conflicting targets.
export function resolveBuyerInquiryScope(value, sharePath, shareToken) {
  if (Array.isArray(value)) {
    if (value.length !== 1) return null;
    value = value[0];
  }
  if (!record(value)) return null;
  const nested = Object.hasOwn(value, 'sharedListing');
  const listing = nested ? value.sharedListing : value;
  if (!record(listing) || (nested && !record(value.horse))) return null;
  const workspaceId = consistentId(
    [value.workspace_id, value.workspaceId, listing.workspace_id, listing.workspaceId],
    true,
  );
  const horseId = consistentId([
    value.horse_id,
    value.horseId,
    listing.horse_id,
    listing.horseId,
    nested ? value.horse.id : undefined,
  ]);
  const listingId = consistentId([
    value.listing_id,
    value.listingId,
    value.id,
    listing.listing_id,
    listing.listingId,
    listing.id,
  ]);
  if (!workspaceId || !horseId || !listingId) return null;
  if (nested && (typeof value.horse.id !== 'string' || !value.horse.id.trim())) return null;
  const paths = [value.share_path, value.sharePath, listing.share_path, listing.sharePath].filter(
    (path) => path !== undefined,
  );
  if ((nested && !paths.length) || paths.some((path) => path !== sharePath)) return null;
  const states = [value.state, listing.state].filter((state) => state !== undefined);
  if ((nested && !states.length) || states.some((state) => state !== 'Live')) return null;
  const modes = [value.access_mode, value.accessMode, listing.access_mode, listing.accessMode].filter(
    (mode) => mode !== undefined,
  );
  if (
    (nested && !modes.length) ||
    modes.some((mode) => !['Private Token', 'Public Link'].includes(mode) || mode !== modes[0])
  )
    return null;
  const accessMode = modes[0] ?? (shareToken ? 'Private Token' : 'Public Link');
  if (accessMode === 'Private Token' && !shareToken) return null;
  return { workspaceId, horseId, listingId, accessMode };
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  if (!(await enforceRateLimit(req, res, RATE_LIMIT))) {
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, message: 'Request body must be valid JSON.' });
  }

  const parsed = parseBody(buyerInquirySchema, body);
  if (!parsed.ok) {
    return sendJson(res, 400, { ok: false, message: parsed.message });
  }
  const { sharePath, shareToken, kind, buyerName, buyerEmail, message } = parsed.data;
  const amount =
    Number.isFinite(Number(parsed.data.amount)) && Number(parsed.data.amount) > 0 ? Number(parsed.data.amount) : null;

  if (!sharePath || !ALLOWED_KINDS.has(kind)) {
    return sendJson(res, 400, { ok: false, message: 'sharePath and a valid kind are required.' });
  }
  if (!buyerName) {
    return sendJson(res, 400, { ok: false, message: 'Your name is required so the seller can respond.' });
  }
  if (kind === 'offer' && !amount) {
    return sendJson(res, 400, { ok: false, message: 'An offer needs an amount.' });
  }
  if ((kind === 'question' || kind === 'proof-requested') && !message) {
    return sendJson(res, 400, {
      ok: false,
      message:
        kind === 'proof-requested'
          ? 'Describe the document you want to review.'
          : 'Enter your question for the seller.',
    });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return sendJson(res, 503, { ok: false, message: 'The workspace service is not configured.' });
  }

  // Validate the share path/token exactly like the public page does: if the
  // listing does not resolve, nothing is written.
  const { data: listing, error: resolveError } = await supabase.rpc('xbar_resolve_public_listing', {
    p_share_path: sharePath,
    p_share_token: shareToken || null,
  });
  if (resolveError || !listing) {
    return sendJson(res, 404, { ok: false, message: 'This listing link is not valid or has been retired.' });
  }
  const scope = resolveBuyerInquiryScope(listing, sharePath, shareToken);
  if (!scope) {
    return sendJson(res, 404, { ok: false, message: 'This listing could not be matched to a workspace.' });
  }
  const { workspaceId, horseId, listingId, accessMode } = scope;

  const { error: insertError } = await supabase.from('public_share_events').insert({
    workspace_id: workspaceId,
    listing_id: listingId,
    horse_id: horseId,
    share_path: sharePath,
    event_type: `buyer-${kind}`,
    access_mode: accessMode,
    metadata: {
      buyerName,
      buyerEmail,
      message,
      amount,
      submittedAt: new Date().toISOString(),
    },
  });
  if (insertError) {
    return sendJson(res, 502, { ok: false, message: 'Your message could not be recorded. Try again.' });
  }

  return sendJson(res, 200, {
    ok: true,
    message:
      kind === 'offer'
        ? 'Your offer was delivered to the seller.'
        : kind === 'packet-downloaded'
          ? 'Your buyer packet is ready and the seller was notified.'
          : kind === 'call-requested'
            ? 'Your call request was delivered to the seller.'
            : kind === 'proof-requested'
              ? 'Your document request was delivered to the seller.'
              : 'Your message was delivered to the seller.',
  });
}

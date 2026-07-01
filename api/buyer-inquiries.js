import { readJsonBody, sendJson } from './_lib/http.js';
import { getSupabaseAdmin } from './_lib/supabase-admin.js';

/*
 * Public buyer folder intake. Anonymous buyers on a shared packet page can
 * ask a question, request a call or proof, submit an offer, or download the
 * buyer packet. The share path/token is validated against the listing (same
 * RPC the public page uses) before anything is written, and events land in
 * public_share_events where the workspace's buyer folder reads them.
 */

const ALLOWED_KINDS = new Set(['question', 'call-requested', 'proof-requested', 'offer', 'packet-downloaded']);
const MAX_MESSAGE_CHARS = 1200;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, message: 'Request body must be valid JSON.' });
  }

  const sharePath = typeof body.sharePath === 'string' ? body.sharePath.trim() : '';
  const shareToken = typeof body.shareToken === 'string' ? body.shareToken.trim() : '';
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const buyerName = typeof body.buyerName === 'string' ? body.buyerName.trim().slice(0, 120) : '';
  const buyerEmail = typeof body.buyerEmail === 'string' ? body.buyerEmail.trim().toLowerCase().slice(0, 200) : '';
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : '';
  const amount = Number.isFinite(Number(body.amount)) && Number(body.amount) > 0 ? Number(body.amount) : null;

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
      message: kind === 'proof-requested' ? 'Describe the proof or document you want to review.' : 'Enter your question for the seller.',
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
  const resolved = Array.isArray(listing) ? listing[0] : listing;
  const workspaceId = resolved?.workspace_id || resolved?.workspaceId;
  const horseId = resolved?.horse_id || resolved?.horseId || '';
  const listingId = resolved?.listing_id || resolved?.listingId || '';
  if (!workspaceId) {
    return sendJson(res, 404, { ok: false, message: 'This listing could not be matched to a workspace.' });
  }

  const { error: insertError } = await supabase.from('public_share_events').insert({
    workspace_id: workspaceId,
    listing_id: listingId,
    horse_id: horseId,
    share_path: sharePath,
    event_type: `buyer-${kind}`,
    access_mode: shareToken ? 'Private Token' : 'Public Link',
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
            ? 'Your proof request was delivered to the seller.'
          : 'Your message was delivered to the seller.',
  });
}

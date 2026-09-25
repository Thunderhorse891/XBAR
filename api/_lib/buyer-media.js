import { readJsonBody, sendJson } from './http.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { enforceRateLimit } from './rate-limit.js';
import { applyCors } from './cors.js';
import { buyerMediaSchema, parseBody } from './validation.js';

/*
 * Buyer media signing for shared listings.
 *
 * The horse-media bucket is private and its storage policies grant anonymous
 * callers nothing, so a buyer on a shared listing cannot mint signed URLs
 * themselves. This endpoint signs on their behalf, with the service role, and
 * only after explicit authorization (contract #8):
 *
 *   1. The share path/token must resolve through the SAME
 *      `xbar_resolve_public_listing` RPC the buyer page uses -- including its
 *      fail-closed private-token check. A bad, missing, or retired token
 *      resolves nothing and the request is refused.
 *   2. The requested storagePath must appear in that listing's horse gallery
 *      with explicit Approved status, matching the buyer-facing photo filter.
 *      Pending, rejected, or missing approval must never reach the signer.
 *
 * Signed URLs live one hour: long enough that a buyer's photo set does not
 * die mid-browse, short enough that a leaked URL is not a permanent backdoor.
 * This mirrors the sale-packets 1-hour convention.
 */

export const BUYER_MEDIA_URL_TTL_SECONDS = 60 * 60;
const RATE_LIMIT = { bucket: 'buyer-media', limit: 60, windowSeconds: 60 };
const MEDIA_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || process.env.VITE_SUPABASE_MEDIA_BUCKET || 'horse-media';

/**
 * Horse-media storage keys look like `<uploader-id>/horses/<horse-id>/media-<id>.<ext>`.
 * Shape check only -- authorization is the gallery-membership check below.
 */
export function isHorseMediaStoragePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) {
    return false;
  }
  if (value.includes('..')) {
    return false;
  }
  const segments = value.split('/');
  if (segments.length !== 4) {
    return false;
  }
  const [uploaderId, horsesSegment, , fileName] = segments;
  if (!uploaderId || horsesSegment !== 'horses' || !fileName) {
    return false;
  }
  return fileName.startsWith('media-');
}

/**
 * Require the requested path to have explicit buyer-facing approval in the
 * resolved gallery. Gallery membership alone does not establish approval.
 */
export function isStoragePathInListingGallery(listing, storagePath) {
  const gallery = listing?.horse?.gallery;
  return (
    Array.isArray(gallery) && gallery.some((asset) => asset?.status === 'Approved' && asset.storagePath === storagePath)
  );
}

/**
 * Authorize + sign one buyer media URL. Pure orchestration over an injected
 * Supabase client so tests can drive it without credentials.
 */
export async function resolveBuyerMediaUrl({
  supabase,
  sharePath,
  shareToken,
  storagePath,
  mediaBucket,
  urlTtlSeconds,
}) {
  if (!isHorseMediaStoragePath(storagePath)) {
    return { ok: false, status: 400, message: 'That photo reference is not valid.' };
  }

  // Validate the share path/token exactly like the public page does: if the
  // listing does not resolve, nothing is signed.
  const listingRequest = {
    p_share_path: sharePath,
    p_share_token: shareToken?.trim() ? shareToken.trim() : null,
  };
  const { data: listing, error: resolveError } = await supabase.rpc('xbar_resolve_public_listing', listingRequest);
  if (resolveError || !listing) {
    return { ok: false, status: 404, message: 'This listing link is not valid or has been retired.' };
  }

  if (!isStoragePathInListingGallery(listing, storagePath)) {
    return { ok: false, status: 403, message: 'This photo is not part of the shared listing.' };
  }

  const { data, error: signError } = await supabase.storage
    .from(mediaBucket)
    .createSignedUrl(storagePath, urlTtlSeconds);
  if (signError || !data?.signedUrl) {
    return { ok: false, status: 502, message: 'The photo could not be prepared. Please try again.' };
  }

  // Signing is asynchronous: a seller can withdraw approval or retire the
  // listing while storage prepares the URL. Discard it if access changed.
  // This cannot revoke URLs already returned for their original lifetime.
  const { data: currentListing, error: recheckError } = await supabase.rpc(
    'xbar_resolve_public_listing',
    listingRequest,
  );
  if (recheckError || !currentListing) {
    return { ok: false, status: 404, message: 'This listing link is not valid or has been retired.' };
  }
  if (!isStoragePathInListingGallery(currentListing, storagePath)) {
    return { ok: false, status: 403, message: 'This photo is not part of the shared listing.' };
  }

  return { ok: true, status: 200, url: data.signedUrl };
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

  const parsed = parseBody(buyerMediaSchema, body);
  if (!parsed.ok) {
    return sendJson(res, 400, { ok: false, message: parsed.message });
  }
  const { sharePath, shareToken, storagePath } = parsed.data;
  if (!sharePath) {
    return sendJson(res, 400, { ok: false, message: 'sharePath is required.' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return sendJson(res, 503, { ok: false, message: 'The workspace service is not configured.' });
  }

  const result = await resolveBuyerMediaUrl({
    supabase,
    sharePath,
    shareToken,
    storagePath,
    mediaBucket: MEDIA_BUCKET,
    urlTtlSeconds: BUYER_MEDIA_URL_TTL_SECONDS,
  });
  if (!result.ok) {
    return sendJson(res, result.status, { ok: false, message: result.message });
  }
  return sendJson(res, 200, { ok: true, url: result.url, expiresIn: BUYER_MEDIA_URL_TTL_SECONDS });
}

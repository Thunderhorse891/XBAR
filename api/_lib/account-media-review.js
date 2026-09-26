import { applyCors } from './cors.js';
import { readJsonBody, sendJson } from './http.js';
import { enforceRateLimit } from './rate-limit.js';
import { requireWorkspaceAccess } from './supabase-admin.js';
import { requireRoleCapability } from './permissions.js';

// Narrow status transition only. Never accept a replacement horse/gallery or
// grant whole-row horse writes to a Sales Lead. Buyer signing is a separate lane.
export default async function handler(req, res) {
  if (!applyCors(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return sendJson(res, 401, { ok: false, message: 'Sign in to review shared media.' });
  if (!(await enforceRateLimit(req, res, { bucket: 'media-review', limit: 30, windowSeconds: 60 }))) return;
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, message: 'Request body must be valid JSON.' });
  }
  const { workspaceId, horseId, assetId, approved, expectedStoragePath, expectedUrl } = body || {};
  if (
    ![workspaceId, horseId, assetId].every(
      (value) => typeof value === 'string' && value.length > 0 && value.length < 200,
    ) ||
    typeof approved !== 'boolean' ||
    typeof expectedStoragePath !== 'string' ||
    typeof expectedUrl !== 'string'
  )
    return sendJson(res, 400, { ok: false, message: 'Workspace, horse, media and review decision are required.' });
  const access = await requireWorkspaceAccess(token, workspaceId);
  if (!access.ok) return sendJson(res, access.status, { ok: false, message: access.message });
  const denied = requireRoleCapability(access.role, 'manageSales');
  if (denied) return sendJson(res, 403, { ok: false, message: denied });
  const { data: horse, error } = await access.supabase
    .from('horses')
    .select('horse_id,payload')
    .eq('workspace_id', workspaceId)
    .eq('horse_id', horseId)
    .maybeSingle();
  if (error) return sendJson(res, 503, { ok: false, message: 'Shared media could not be loaded.' });
  const gallery = horse?.payload?.gallery;
  const matches = Array.isArray(gallery) ? gallery.filter((asset) => asset?.id === assetId) : [];
  if (matches.length !== 1 || !(matches[0].storagePath || matches[0].url))
    return sendJson(res, 409, {
      ok: false,
      message: 'Wait for this image to finish syncing, then reload it before review.',
    });
  if ((matches[0].storagePath || '') !== expectedStoragePath || (matches[0].url || '') !== expectedUrl)
    return sendJson(res, 409, { ok: false, message: 'This image changed. Reload it before review.' });
  const status = approved ? 'Approved' : 'Pending';
  const payload = {
    ...horse.payload,
    gallery: gallery.map((asset) => (asset.id === assetId ? { ...asset, status } : asset)),
  };
  // Compare the complete payload read above, not a client-supplied timestamp.
  // A concurrent gallery/horse update must cause a refusal rather than be lost.
  const { data: saved, error: saveError } = await access.supabase
    .from('horses')
    .update({ payload, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('horse_id', horseId)
    .eq('payload', JSON.stringify(horse.payload))
    .select('horse_id')
    .maybeSingle();
  if (saveError) return sendJson(res, 503, { ok: false, message: 'Shared media review could not be saved.' });
  if (!saved)
    return sendJson(res, 409, { ok: false, message: 'The horse changed during review. Reload and try again.' });
  return sendJson(res, 200, { ok: true, workspaceId, horseId, assetId, status });
}

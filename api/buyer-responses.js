import { recordAuditEvent } from './_lib/audit.js';
import { readJsonBody, sendJson } from './_lib/http.js';
import { requireWorkspaceAccess } from './_lib/supabase-admin.js';
import { enforceRateLimit } from './_lib/rate-limit.js';

const RESPONSE_ROLES = new Set(['Admin', 'Ranch Manager', 'Sales Lead']);

const RATE_LIMIT = { bucket: 'buyer-responses', limit: 30, windowSeconds: 60 };

export default async function handler(req, res) {
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

  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
  const replyToEventId = typeof body.replyToEventId === 'string' ? body.replyToEventId.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1200) : '';
  if (!workspaceId || !replyToEventId || !note) {
    return sendJson(res, 400, { ok: false, message: 'Workspace, buyer request, and response note are required.' });
  }

  const accessToken = String(req.headers?.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const access = await requireWorkspaceAccess(accessToken, workspaceId);
  if (!access.ok) {
    return sendJson(res, access.status, { ok: false, message: access.message });
  }
  if (!RESPONSE_ROLES.has(access.role)) {
    return sendJson(res, 403, { ok: false, message: 'This workspace role cannot resolve buyer requests.' });
  }

  const publicEventId = replyToEventId.replace(/^public-share-/, '');
  const { data: target, error: targetError } = await access.supabase
    .from('public_share_events')
    .select('id, listing_id, horse_id')
    .eq('workspace_id', workspaceId)
    .eq('id', publicEventId)
    .maybeSingle();
  if (targetError || !target?.id) {
    return sendJson(res, 404, { ok: false, message: 'The buyer request could not be matched to this workspace.' });
  }

  const actor = access.user.email || access.role;
  const { data: event, error: insertError } = await access.supabase
    .from('public_share_events')
    .insert({
      workspace_id: workspaceId,
      listing_id: target.listing_id || '',
      horse_id: target.horse_id || '',
      event_type: 'seller-response',
      access_mode: 'Workspace',
      metadata: {
        actor,
        role: access.role,
        note,
        replyToEventId,
        submittedAt: new Date().toISOString(),
      },
    })
    .select('id, listing_id, horse_id, event_type, metadata, viewed_at, created_at')
    .single();
  if (insertError || !event) {
    return sendJson(res, 502, { ok: false, message: 'The seller response could not be recorded. Try again.' });
  }

  await recordAuditEvent(access.supabase, {
    workspaceId,
    actorUserId: access.user.id,
    action: 'buyer_request.responded',
    entityType: 'public-share-event',
    entityId: publicEventId,
    metadata: { horseId: target.horse_id || '', replyToEventId },
  });

  return sendJson(res, 200, { ok: true, message: 'Seller response recorded in the cloud buyer timeline.', event });
}

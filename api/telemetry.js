import { readJsonBody, sendJson } from './_lib/http.js';
import { requireWorkspaceAccess } from './_lib/supabase-admin.js';

const ALLOWED_SEVERITIES = new Set(['info', 'warning', 'error']);
const MAX_EVENT_NAME_CHARS = 200;
const MAX_PAYLOAD_BYTES = 8 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  const accessToken = req.headers?.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, message: 'Request body must be valid JSON.' });
  }

  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  if (!workspaceId) {
    return sendJson(res, 400, { ok: false, message: 'workspaceId is required.' });
  }

  const access = await requireWorkspaceAccess(accessToken, workspaceId);
  if (!access.ok) {
    // Telemetry is best-effort: when admin credentials are not configured we
    // skip silently instead of surfacing an error to the client.
    if (access.status === 503) {
      return sendJson(res, 202, { ok: true, message: 'Telemetry skipped because admin credentials are not configured.' });
    }
    return sendJson(res, access.status, { ok: false, message: access.message });
  }

  const eventName = (typeof body.eventName === 'string' && body.eventName ? body.eventName : 'runtime.event').slice(0, MAX_EVENT_NAME_CHARS);
  const severity = typeof body.severity === 'string' && ALLOWED_SEVERITIES.has(body.severity) ? body.severity : 'info';
  let payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
    payload = { truncated: true };
  }

  await access.supabase.from('runtime_events').insert({
    workspace_id: workspaceId,
    user_id: access.user.id,
    channel: 'web',
    severity,
    event_name: eventName,
    payload,
  });

  return sendJson(res, 200, { ok: true });
}

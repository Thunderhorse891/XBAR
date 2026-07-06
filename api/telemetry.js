import { readJsonBody, sendJson } from './_lib/http.js';
import { getSupabaseAdmin, requireWorkspaceAccess } from './_lib/supabase-admin.js';
import { enforceRateLimit } from './_lib/rate-limit.js';

/*
 * Runtime telemetry intake. This runs with the Supabase service-role key, so a
 * client-supplied workspaceId is never trusted on its own: the workspace is
 * only attached when a valid access token proves the caller is a member of it.
 * Forged or unauthenticated events are still accepted for crash visibility but
 * are stored as anonymous (workspace_id / user_id = null) so they cannot
 * pollute another workspace's records. Payload and string sizes are capped to
 * prevent write amplification, and the endpoint is per-IP rate limited.
 */

const ALLOWED_SEVERITIES = new Set(['info', 'warning', 'error']);
const MAX_EVENT_NAME_CHARS = 120;
const MAX_PAYLOAD_BYTES = 8_192;
const RATE_LIMIT = { bucket: 'telemetry', limit: 60, windowSeconds: 60 };

function sanitizePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
      return { truncated: true };
    }
    return value;
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  if (!(await enforceRateLimit(req, res, RATE_LIMIT))) {
    return;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return sendJson(res, 202, { ok: true, message: 'Telemetry skipped because admin credentials are not configured.' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, message: 'Request body must be valid JSON.' });
  }

  const requestedWorkspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const rawEventName = typeof body.eventName === 'string' ? body.eventName : 'runtime.event';
  const eventName = rawEventName.slice(0, MAX_EVENT_NAME_CHARS) || 'runtime.event';
  const severity = ALLOWED_SEVERITIES.has(body.severity) ? body.severity : 'info';
  const payload = sanitizePayload(body.payload);

  // Only associate the event with a workspace when the caller proves membership.
  let workspaceId = null;
  let userId = null;
  if (requestedWorkspaceId) {
    const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
    if (accessToken) {
      const access = await requireWorkspaceAccess(accessToken, requestedWorkspaceId);
      if (access.ok) {
        workspaceId = requestedWorkspaceId;
        userId = access.user.id;
      }
    }
  }

  const { error } = await supabase.from('runtime_events').insert({
    workspace_id: workspaceId,
    user_id: userId,
    channel: 'web',
    severity,
    event_name: eventName,
    payload,
  });

  if (error) {
    return sendJson(res, 502, { ok: false, message: 'Telemetry could not be recorded.' });
  }

  return sendJson(res, 200, { ok: true });
}

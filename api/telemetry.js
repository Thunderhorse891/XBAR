import { readJsonBody, sendJson } from './_lib/http.js';
import { getSupabaseAdmin } from './_lib/supabase-admin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_SEVERITIES = new Set(['info', 'warn', 'error']);

const ALLOWED_EVENT_PREFIX = [
  'navigation.',
  'auth.',
  'horse.',
  'document.',
  'medical.',
  'breeding.',
  'sales.',
  'ownership.',
  'expenses.',
  'reminders.',
  'assets.',
  'weather.',
  'subscription.',
  'workspace.',
  'runtime.',
  'sync.',
  'share.',
];

function isAllowedEventName(name) {
  if (typeof name !== 'string' || name.length > 128) return false;
  return ALLOWED_EVENT_PREFIX.some((prefix) => name.startsWith(prefix));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return sendJson(res, 202, { ok: true, message: 'Telemetry skipped — admin credentials not configured.' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { ok: false, message: err.message });
  }

  const rawWorkspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : null;
  const workspaceId = rawWorkspaceId && UUID_RE.test(rawWorkspaceId) ? rawWorkspaceId : null;

  const eventName = isAllowedEventName(body.eventName) ? body.eventName : 'runtime.event';
  const severity = ALLOWED_SEVERITIES.has(body.severity) ? body.severity : 'info';

  const payload =
    body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : {};

  await supabase.from('runtime_events').insert({
    workspace_id: workspaceId,
    user_id: null,
    channel: 'web',
    severity,
    event_name: eventName,
    payload,
  });

  return sendJson(res, 200, { ok: true });
}

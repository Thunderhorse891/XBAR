import { readJsonBody, sendJson } from './_lib/http.js';
import { getSupabaseAdmin } from './_lib/supabase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return sendJson(res, 202, { ok: true, message: 'Telemetry skipped because admin credentials are not configured.' });
  }

  const body = await readJsonBody(req);
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : null;
  const eventName = typeof body.eventName === 'string' ? body.eventName : 'runtime.event';
  const severity = typeof body.severity === 'string' ? body.severity : 'info';
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

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

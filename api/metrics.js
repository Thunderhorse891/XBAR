import { sendJson, readJsonBody } from './_lib/http.js';
import { getSupabaseAdmin } from './_lib/supabase-admin.js';
import { enforceRateLimit } from './_lib/rate-limit.js';
import { applyCors } from './_lib/cors.js';

/*
 * First-party marketing analytics intake. The static site ships no third-party
 * scripts (script-src 'self'), so /site.js beacons pageviews and CTA clicks
 * here instead. Events are anonymous by design: no cookies, no user or
 * workspace association, no IP persistence. Every accepted event is emitted to
 * the function log (visible in Vercel's log stream even with no database), and
 * additionally stored in runtime_events when Supabase is configured.
 */

const RATE_LIMIT = { bucket: 'metrics', limit: 120, windowSeconds: 60 };

const EVENT_TYPES = new Set(['pageview', 'signup_click', 'sample_packet_click']);
const MAX_FIELD_LENGTH = 512;

function capString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FIELD_LENGTH);
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

  const type = typeof body?.type === 'string' ? body.type : '';
  if (!EVENT_TYPES.has(type)) {
    return sendJson(res, 400, { ok: false, message: 'Unknown metric type.' });
  }

  const path = capString(body?.path);
  if (!path || !path.startsWith('/')) {
    return sendJson(res, 400, { ok: false, message: 'A site-relative path is required.' });
  }

  const event = {
    type,
    path,
    referrer: capString(body?.referrer),
    href: capString(body?.href),
  };

  // Always visible in the deployment's function logs, even with no database.
  console.log(JSON.stringify({ source: 'web-metrics', at: new Date().toISOString(), ...event }));

  const supabase = getSupabaseAdmin();
  if (supabase) {
    // Anonymous by design: never attach workspace_id / user_id to site metrics.
    const { error } = await supabase.from('runtime_events').insert({
      workspace_id: null,
      user_id: null,
      channel: 'web',
      severity: 'info',
      event_name: `marketing.${type}`,
      payload: { path: event.path, referrer: event.referrer, href: event.href },
    });
    if (error) {
      // The log line above already captured the event; don't fail the beacon.
      console.warn('[metrics] runtime_events insert failed:', error.message);
    }
  }

  res.statusCode = 204;
  res.end();
}

import { timingSafeEqual } from 'node:crypto';
import { sendJson } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabase-admin.js';
import { processTrialReminders } from '../_lib/lifecycleTriggers.js';

// Daily background job (Vercel cron — see the /api/cron/trial-reminders entry
// in vercel.json; schedule it for once a day, e.g. "0 13 * * *").
//
// For every workspace whose trial ends within the "ending soon" window or has
// just expired: send the matching lifecycle email, exactly once per trial
// period. Idempotency is by atomic claim rows in
// workspace_subscription_events (see lifecycleTriggers.js), so a retried or
// double-fired cron cannot double-send.
//
// Auth: same CRON_SECRET bearer pattern as /api/reminders/run.

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  const cronSecret = process.env.CRON_SECRET || '';
  const provided = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  const providedBuffer = Buffer.from(provided);
  const secretBuffer = Buffer.from(cronSecret);
  const secretsMatch =
    providedBuffer.length === secretBuffer.length &&
    cronSecret.length > 0 &&
    timingSafeEqual(providedBuffer, secretBuffer);
  if (!secretsMatch) {
    return sendJson(res, 401, { ok: false, message: 'Invalid or missing cron secret.' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return sendJson(res, 503, { ok: false, message: 'Supabase admin credentials are not configured.' });
  }

  try {
    const result = await processTrialReminders({ supabase, nowIso: new Date().toISOString() });
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      message: error instanceof Error ? error.message : 'Trial reminders failed.',
    });
  }
}

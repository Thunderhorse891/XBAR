import { sendJson } from './http.js';
import { getSupabaseAdmin } from './supabase-admin.js';
import { enforceRateLimit } from './rate-limit.js';
import { sendWelcomeForUser } from './lifecycleTriggers.js';
import { applyCors } from './cors.js';

// POST /api/account/send-welcome
//
// Best-effort welcome email for a freshly signed-up account. The client calls
// this once after signup completes; the server verifies the bearer token,
// sends the welcome, and records the send idempotently (a second call is a
// no-op, so a retry cannot double-send).
//
// Rate-limited: a signed-in user gains nothing by calling this twice, and an
// attacker holding a stolen token must not be able to turn it into an email
// cannon.
const RATE_LIMIT = { bucket: 'send-welcome', limit: 5, windowSeconds: 60 };

export default async function handler(req, res) {
  if (!applyCors(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  if (!(await enforceRateLimit(req, res, RATE_LIMIT))) {
    return;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return sendJson(res, 503, { ok: false, message: 'Supabase admin credentials are not configured.' });
  }

  const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  if (!accessToken) {
    return sendJson(res, 401, { ok: false, message: 'Missing access token.' });
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return sendJson(res, 401, { ok: false, message: userError?.message || 'Unable to verify the signed-in user.' });
  }

  try {
    const result = await sendWelcomeForUser({ supabase, user: userData.user });
    if (result.ok) {
      return sendJson(res, 200, result);
    }
    return sendJson(res, 502, result);
  } catch (error) {
    return sendJson(res, 500, { ok: false, message: error instanceof Error ? error.message : 'Welcome email failed.' });
  }
}

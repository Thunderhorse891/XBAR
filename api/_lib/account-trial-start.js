import { readJsonBody, sendJson } from './http.js';
import { getSupabaseAdmin, requireWorkspaceAccess } from './supabase-admin.js';
import { startWorkspaceTrial } from './trial-status.js';
import { trialStartSchema, parseBody } from './validation.js';
import { enforceRateLimit } from './rate-limit.js';
import { applyCors } from './cors.js';

/*
 * Start the workspace's 14-day Professional trial.
 *
 * App-side only: no Stripe, no card, no subscription object. The trial is a
 * record on the workspace's subscription profile
 * (`payload.trial = { startedAt, endsAt, plan }`), written here through the
 * service role because workspace users have no write access to
 * `workspace_subscription_profiles` — the client can ask for a trial but can
 * never grant itself one.
 *
 * Admin-only, consistent with managed billing and invites: starting a trial
 * changes what the whole workspace may do.
 */

const RATE_LIMIT = { bucket: 'trial-start', limit: 5, windowSeconds: 60 };

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

  const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  const body = await readJsonBody(req);
  const parsed = parseBody(trialStartSchema, body);
  if (!parsed.ok) {
    return sendJson(res, 400, { ok: false, message: parsed.message });
  }
  const { workspaceId } = parsed.data;

  const access = await requireWorkspaceAccess(accessToken, workspaceId);
  if (!access.ok) {
    return sendJson(res, access.status, { ok: false, message: access.message });
  }

  if (access.role !== 'Admin') {
    return sendJson(res, 403, { ok: false, message: 'Only workspace admins can start the Professional trial.' });
  }

  const supabase = getSupabaseAdmin();
  const result = await startWorkspaceTrial(supabase, workspaceId);

  if (!result.ok) {
    return sendJson(res, result.status ?? 400, { ok: false, code: result.code, message: result.message });
  }

  return sendJson(res, 200, { ok: true, trial: result.trial });
}

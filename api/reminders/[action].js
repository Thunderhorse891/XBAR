import { withCronHeartbeat } from '../_lib/cron-heartbeat.js';
import { withErrorTracking } from '../_lib/error-tracking.js';
import { sendJson } from '../_lib/http.js';
import runHandler from '../_lib/reminders-run.js';
import trialRemindersHandler from '../_lib/reminders-trial.js';

/*
 * Single Vercel function serving the reminder cron routes:
 *   GET|POST /api/reminders/run              -> due-date reminder emails
 *   GET|POST /api/reminders/trial-reminders  -> trial lifecycle emails
 *                                              (moved from
 *                                               /api/cron/trial-reminders;
 *                                               the vercel.json cron schedule
 *                                               was updated to the new path)
 * Consolidated as a dynamic route so the endpoints share one serverless
 * function (Hobby-plan function budget) while keeping their public paths.
 * Each sub-handler keeps its own CRON_SECRET auth and idempotency.
 */

function resolveAction(req) {
  if (req.query && typeof req.query.action === 'string') {
    return req.query.action;
  }
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  return pathname.split('/').filter(Boolean).pop() || '';
}

async function handler(req, res) {
  const action = resolveAction(req);
  if (action === 'run') {
    return withCronHeartbeat('run', runHandler)(req, res);
  }
  if (action === 'trial-reminders') {
    return withCronHeartbeat('trial-reminders', trialRemindersHandler)(req, res);
  }
  return sendJson(res, 404, { ok: false, message: 'Unknown reminders action.' });
}

export default withErrorTracking(handler, 'reminders/[action].js');

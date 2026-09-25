import { sendJson } from '../_lib/http.js';
import deleteHandler from '../_lib/account-delete.js';
import sendWelcomeHandler from '../_lib/account-send-welcome.js';
import trialStartHandler from '../_lib/account-trial-start.js';

/*
 * Single Vercel function serving the account routes:
 *   POST /api/account/delete        -> irreversible in-app account deletion
 *   POST /api/account/send-welcome  -> best-effort welcome email after signup
 *   POST /api/account/trial-start   -> start the workspace's 14-day
 *                                      Professional trial (moved from
 *                                      /api/trial/start; the client calls the
 *                                      new path)
 * Consolidated as a dynamic route so the endpoints share one serverless
 * function (Hobby-plan function budget) while keeping their public paths.
 * Each sub-handler keeps its own CORS, rate limiting, auth, and validation.
 */

function resolveAction(req) {
  if (req.query && typeof req.query.action === 'string') {
    return req.query.action;
  }
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  return pathname.split('/').filter(Boolean).pop() || '';
}

export default async function handler(req, res) {
  const action = resolveAction(req);
  if (action === 'delete') {
    return deleteHandler(req, res);
  }
  if (action === 'send-welcome') {
    return sendWelcomeHandler(req, res);
  }
  if (action === 'trial-start') {
    return trialStartHandler(req, res);
  }
  return sendJson(res, 404, { ok: false, message: 'Unknown account action.' });
}

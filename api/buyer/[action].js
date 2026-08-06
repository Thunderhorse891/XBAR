import { sendJson } from '../_lib/http.js';
import inquiriesHandler from '../_lib/buyer-inquiries.js';
import responsesHandler from '../_lib/buyer-responses.js';
import verifyHandler from '../_lib/buyer-verify.js';

/*
 * Single Vercel function serving the buyer routes:
 *   POST     /api/buyer/inquiries  -> anonymous buyer intake on a shared packet
 *   POST     /api/buyer/responses  -> workspace seller reply to a buyer request
 *   GET/POST /api/buyer/verify     -> anonymous packet verification against the
 *                                     server-anchored seal
 * Consolidated as a dynamic route so the endpoints share one serverless
 * function (matching api/documents/[action] and api/horses/[action]). Each
 * sub-handler keeps its own CORS, rate limiting, auth, and validation.
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
  if (action === 'inquiries') {
    return inquiriesHandler(req, res);
  }
  if (action === 'responses') {
    return responsesHandler(req, res);
  }
  if (action === 'verify') {
    return verifyHandler(req, res);
  }
  return sendJson(res, 404, { ok: false, message: 'Unknown buyer action.' });
}

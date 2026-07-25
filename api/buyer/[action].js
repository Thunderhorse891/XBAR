import { sendJson } from '../_lib/http.js';
import inquiriesHandler from '../_lib/buyer-inquiries.js';
import responsesHandler from '../_lib/buyer-responses.js';

/*
 * Single Vercel function serving both buyer routes:
 *   POST /api/buyer/inquiries  -> anonymous buyer intake on a shared packet
 *   POST /api/buyer/responses  -> workspace seller reply to a buyer request
 * Consolidated as a dynamic route so the two endpoints share one serverless
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
  return sendJson(res, 404, { ok: false, message: 'Unknown buyer action.' });
}

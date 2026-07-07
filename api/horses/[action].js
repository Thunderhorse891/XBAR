import { sendJson } from '../_lib/http.js';
import importHandler from '../_lib/horses-import.js';
import exportHandler from '../_lib/horses-export.js';

/*
 * Single Vercel function serving both horse data routes:
 *   POST /api/horses/import   -> CSV bulk import
 *   GET  /api/horses/export   -> full per-horse export
 * Consolidated as a dynamic route so the two endpoints share one serverless
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
  if (action === 'import') {
    return importHandler(req, res);
  }
  if (action === 'export') {
    return exportHandler(req, res);
  }
  return sendJson(res, 404, { ok: false, message: 'Unknown horses action.' });
}

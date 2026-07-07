import { sendJson } from '../_lib/http.js';
import bulkUploadHandler from '../_lib/documents-bulk-upload.js';
import generateTemplateHandler from '../_lib/documents-generate-template.js';

/*
 * Single Vercel function serving both document routes:
 *   POST /api/documents/bulk-upload-with-ocr    -> OCR bulk intake
 *   POST /api/documents/generate-from-template  -> template PDF generation
 * Consolidated as a dynamic route so the two endpoints share one serverless
 * function while keeping their public paths. Each sub-handler keeps its own
 * CORS, rate limiting, auth, and validation.
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
  if (action === 'bulk-upload-with-ocr') {
    return bulkUploadHandler(req, res);
  }
  if (action === 'generate-from-template') {
    return generateTemplateHandler(req, res);
  }
  return sendJson(res, 404, { ok: false, message: 'Unknown documents action.' });
}

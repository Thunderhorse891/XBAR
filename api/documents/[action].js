import storageUploadsHandler from '../_lib/storage-uploads.js';
import { sendJson } from '../_lib/http.js';
import bulkUploadHandler from '../_lib/documents-bulk-upload.js';
import generateTemplateHandler from '../_lib/documents-generate-template.js';

/*
 * Single Vercel function serving document and storage-control routes:
 *   POST /api/documents/bulk-upload-with-ocr    -> OCR bulk intake
 *   POST /api/documents/generate-from-template  -> template PDF generation
 *   POST /api/storage/uploads -> storage control (exact Vercel rewrite)
 * Consolidated as a dynamic route so these endpoints share one serverless
 * function while keeping their public paths. Each sub-handler keeps its own
 * CORS, rate limiting, auth, and validation.
 */

// Every sub-handler consumes its own raw stream; storage control adds a strict
// 16 KiB limit without changing the existing OCR/template body contracts.
export const config = { api: { bodyParser: false } };

function resolveAction(req) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname === '/api/storage/uploads' || pathname === '/api/documents/storage-uploads') return 'storage-uploads';
  if (req.query && typeof req.query.action === 'string') {
    return req.query.action;
  }
  return pathname.split('/').filter(Boolean).pop() || '';
}

export default async function handler(req, res) {
  const action = resolveAction(req);
  if (action === 'storage-uploads') return storageUploadsHandler(req, res);
  if (action === 'bulk-upload-with-ocr') {
    return bulkUploadHandler(req, res);
  }
  if (action === 'generate-from-template') {
    return generateTemplateHandler(req, res);
  }
  return sendJson(res, 404, { ok: false, message: 'Unknown documents action.' });
}

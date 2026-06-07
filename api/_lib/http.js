const MAX_BODY_BYTES = 512 * 1024; // 512 KB

export async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buf.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      const err = new Error('Request body too large.');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Invalid JSON in request body.');
    err.statusCode = 400;
    throw err;
  }
}

export async function readRawBody(req) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buf.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      const err = new Error('Request body too large.');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/*
 * Explicit CORS policy for the API surface. Browser requests from the app are
 * same-origin, so by default no CORS headers are needed. This makes the policy
 * explicit for the public endpoints: only the configured application origins
 * are ever reflected, and preflight requests are answered without touching the
 * handler body.
 */

function getAllowedOrigins() {
  const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  return [process.env.PUBLIC_APP_URL, process.env.VITE_PUBLIC_APP_URL, vercelOrigin]
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}

/**
 * Apply the CORS policy for the current request.
 *
 * Returns true when the handler should continue. Returns false when the
 * request was a preflight (OPTIONS) that has already been answered.
 */
export function applyCors(req, res, { methods = 'POST, OPTIONS' } = {}) {
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers?.origin;

  res.setHeader('Vary', 'Origin');
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return false;
  }

  return true;
}

import { sendJson } from './http.js';

/*
 * Lightweight, dependency-free rate limiting for the public API surface.
 *
 * Strategy:
 *  - If Upstash Redis REST credentials are configured
 *    (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN), use a fixed-window
 *    counter that is shared across every serverless instance and region.
 *  - Missing or failed shared storage refuses with 503. Local memory mode is
 *    explicit, restricted to development/tests, and never allowed on Vercel.
 */

const memoryBuckets = new Map();
const MEMORY_PRUNE_INTERVAL_MS = 60_000;
let lastPrune = 0;

function pruneMemory(now) {
  if (now - lastPrune < MEMORY_PRUNE_INTERVAL_MS) {
    return;
  }
  lastPrune = now;
  for (const [key, entry] of memoryBuckets) {
    if (entry.resetAt <= now) {
      memoryBuckets.delete(key);
    }
  }
}

export function getClientIp(req) {
  const headers = req.headers || {};
  const forwarded = headers['x-forwarded-for'];
  // Node may hand repeated headers over as an array; the last header wins.
  const forwardedValue = Array.isArray(forwarded) ? forwarded[forwarded.length - 1] : forwarded;
  if (typeof forwardedValue === 'string' && forwardedValue.trim().length > 0) {
    // Trust the RIGHTMOST entry. Vercel appends the real client IP last, so
    // every entry to its left is client-controlled and freely spoofable. The
    // old code took the leftmost entry, which let any caller pick the IP the
    // rate limiter counted against and dodge the limit entirely.
    const entries = forwardedValue
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length > 0) {
      return entries[entries.length - 1];
    }
  }
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

async function checkUpstash(key, limit, windowSeconds) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Shared rate limiter unavailable');
  }

  const response = await fetch(url.replace(/\/$/, ''), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    // Counter and expiry are one atomic operation, including first creation.
    body: JSON.stringify([
      'EVAL',
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
      1,
      key,
      windowSeconds,
    ]),
    signal: AbortSignal.timeout(1500),
  });

  if (!response.ok) {
    throw new Error('Shared rate limiter unavailable');
  }

  const results = await response.json();
  const count = results?.result;
  if (results?.error || !Number.isSafeInteger(count) || count < 1) throw new Error('Invalid rate limiter response');
  const ok = count <= limit;
  return {
    ok,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: ok ? 0 : windowSeconds,
  };
}

function checkMemory(key, limit, windowSeconds) {
  const now = Date.now();
  pruneMemory(now);
  const windowMs = windowSeconds * 1000;
  const existing = memoryBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const ok = existing.count <= limit;
  return {
    ok,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: ok ? 0 : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/**
 * Enforce a fixed-window rate limit for the current request.
 *
 * On success returns true. On limit breach it writes a 429 JSON response
 * (with a Retry-After header) and returns false, so callers can early-return.
 */
export async function enforceRateLimit(req, res, { bucket, limit, windowSeconds }) {
  const ip = getClientIp(req);
  const key = `xbar:rl:${bucket}:${ip}`;

  let result;
  try {
    const localMemory =
      process.env.RATE_LIMIT_MODE === 'memory' &&
      ['test', 'development'].includes(process.env.NODE_ENV) &&
      !process.env.VERCEL;
    result = localMemory ? checkMemory(key, limit, windowSeconds) : await checkUpstash(key, limit, windowSeconds);
  } catch {
    res.setHeader('Retry-After', '30');
    sendJson(res, 503, {
      ok: false,
      code: 'rate_limit_unavailable',
      message: 'Request protection is temporarily unavailable. Please try again shortly.',
    });
    return false;
  }

  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));

  if (!result.ok) {
    if (result.retryAfterSeconds > 0) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
    }
    sendJson(res, 429, {
      ok: false,
      message: 'Too many requests. Please slow down and try again shortly.',
    });
    return false;
  }

  return true;
}

import { sendJson } from './http.js';

/*
 * Lightweight, dependency-free rate limiting for the public API surface.
 *
 * Strategy:
 *  - If Upstash Redis REST credentials are configured
 *    (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN), use a fixed-window
 *    counter that is shared across every serverless instance and region.
 *  - Otherwise fall back to a per-instance in-memory window. This is best
 *    effort (each cold serverless instance keeps its own counter) but still
 *    blunts naive floods and keeps local/dev working with zero configuration.
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
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

async function checkUpstash(key, limit, windowSeconds) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }

  const response = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, windowSeconds, 'NX'],
    ]),
  });

  if (!response.ok) {
    // Fail open: never let a rate-limiter outage take down the endpoint.
    return { ok: true, remaining: limit, retryAfterSeconds: 0 };
  }

  const results = await response.json();
  const count = Number(Array.isArray(results) ? results[0]?.result : 0) || 0;
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
    result = (await checkUpstash(key, limit, windowSeconds)) || checkMemory(key, limit, windowSeconds);
  } catch {
    // Fail open on any limiter error.
    result = { ok: true, remaining: limit, retryAfterSeconds: 0 };
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

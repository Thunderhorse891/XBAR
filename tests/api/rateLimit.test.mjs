import assert from 'node:assert/strict';
import test from 'node:test';

import { enforceRateLimit, getClientIp } from '../../api/_lib/rate-limit.js';

/*
 * X-Forwarded-For spoofing. Vercel appends the real client IP as the LAST
 * entry of X-Forwarded-For, so every entry to its left is client-controlled.
 * getClientIp used to take the leftmost entry, which let any caller dictate
 * the IP the rate limiter counted against -- send a fresh spoofed leftmost
 * value per request and no limit ever fires. The fix trusts the rightmost
 * entry; these tests pin that behavior at both the extraction layer and the
 * enforced limit.
 */

function reqWith(headers, remoteAddress) {
  return { headers, socket: remoteAddress ? { remoteAddress } : undefined };
}

test('a spoofed leftmost entry does not become the client IP', () => {
  const ip = getClientIp(reqWith({ 'x-forwarded-for': 'spoofed-attacker-ip, 203.0.113.7' }));
  assert.equal(ip, '203.0.113.7');
});

test('the rightmost entry wins with several proxies in the chain', () => {
  const ip = getClientIp(reqWith({ 'x-forwarded-for': '10.0.0.1, 198.51.100.9, 203.0.113.44' }));
  assert.equal(ip, '203.0.113.44');
});

test('a single IP in X-Forwarded-For is used as-is', () => {
  assert.equal(getClientIp(reqWith({ 'x-forwarded-for': '192.0.2.60' })), '192.0.2.60');
});

test('entries are trimmed before the rightmost is picked', () => {
  assert.equal(getClientIp(reqWith({ 'x-forwarded-for': '  10.0.0.1 ,\t203.0.113.8  ' })), '203.0.113.8');
});

test('an empty or blank X-Forwarded-For falls through to x-real-ip', () => {
  assert.equal(getClientIp(reqWith({ 'x-forwarded-for': '', 'x-real-ip': '198.51.100.3' })), '198.51.100.3');
  assert.equal(getClientIp(reqWith({ 'x-forwarded-for': ' ,  ', 'x-real-ip': '198.51.100.4' })), '198.51.100.4');
});

test('a missing X-Forwarded-For falls back to x-real-ip', () => {
  assert.equal(getClientIp(reqWith({ 'x-real-ip': '198.51.100.5' })), '198.51.100.5');
});

test('with no forwarding headers the socket address is used', () => {
  assert.equal(getClientIp(reqWith({}, '203.0.113.99')), '203.0.113.99');
});

test('with nothing at all the IP is reported unknown rather than crashing', () => {
  assert.equal(getClientIp(reqWith({})), 'unknown');
});

test('a repeated header array resolves to the rightmost entry of the last header', () => {
  const ip = getClientIp(reqWith({ 'x-forwarded-for': ['10.0.0.1, 10.0.0.2', 'spoofed, 203.0.113.21'] }));
  assert.equal(ip, '203.0.113.21');
});

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: '',
    setHeader(name, value) {
      headers[name] = value;
    },
    end(chunk) {
      this.body = String(chunk ?? '');
    },
  };
}

test('rotating the spoofed leftmost entry does not escape the limit on the real IP', async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const bucket = `rate-limit-spoof-${Date.now()}`;
  const opts = { bucket, limit: 1, windowSeconds: 60 };

  const first = mockRes();
  assert.equal(await enforceRateLimit(reqWith({ 'x-forwarded-for': 'spoofed-one, 203.0.113.200' }), first, opts), true);

  // Same real client IP, brand-new spoofed leftmost value: still over the limit.
  const second = mockRes();
  assert.equal(
    await enforceRateLimit(reqWith({ 'x-forwarded-for': 'spoofed-two, 203.0.113.200' }), second, opts),
    false,
  );
  assert.equal(second.statusCode, 429);
  assert.match(second.body, /Too many requests/);

  // A different real IP gets its own bucket and is allowed.
  const other = mockRes();
  assert.equal(
    await enforceRateLimit(reqWith({ 'x-forwarded-for': 'spoofed-three, 203.0.113.201' }), other, opts),
    true,
  );
  assert.equal(other.statusCode, 200);
});

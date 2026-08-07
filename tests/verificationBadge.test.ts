import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBadgeSnippet, buildShareText, buildVerifyPath, buildVerifyUrl } from '../src/lib/verificationBadge.js';

test('verify path is basename-relative under /app', () => {
  assert.equal(buildVerifyPath('packet-abc'), '/app/verify/packet-abc');
});

test('verify url joins origin without doubling the slash', () => {
  assert.equal(buildVerifyUrl('https://xbar.app', 'packet-abc'), 'https://xbar.app/app/verify/packet-abc');
  assert.equal(buildVerifyUrl('https://xbar.app/', 'packet-abc'), 'https://xbar.app/app/verify/packet-abc');
});

test('badge snippet is a self-contained anchor to the verify url with the seal code', () => {
  const snippet = buildBadgeSnippet('https://xbar.app/app/verify/packet-abc', 'SEAL-BA78-16BF-8F01');
  assert.match(snippet, /^<a /);
  assert.ok(snippet.includes('href="https://xbar.app/app/verify/packet-abc"'));
  assert.ok(snippet.includes('SEAL-BA78-16BF-8F01'));
  assert.ok(snippet.includes('Verified by XBAR'));
  assert.ok(snippet.includes('target="_blank"'));
  assert.ok(snippet.includes('rel="noopener noreferrer"'));
  // No script, honest label only — never claims an appraisal.
  assert.ok(!/<script/i.test(snippet));
  assert.ok(!/apprais/i.test(snippet));
});

test('badge snippet HTML-escapes its inputs so a listing embed is safe', () => {
  const snippet = buildBadgeSnippet('https://x.test/app/verify/p"><script>alert(1)</script>', 'SEAL-"><b>');
  assert.ok(!snippet.includes('<script>'));
  assert.ok(snippet.includes('&lt;script&gt;'));
  assert.ok(snippet.includes('&quot;'));
});

test('badge snippet omits the seal code cleanly when none is given', () => {
  const snippet = buildBadgeSnippet('https://xbar.app/app/verify/packet-abc', '');
  assert.ok(snippet.includes('Verified by XBAR'));
  assert.ok(!snippet.includes('&middot;'));
});

test('share text is honest and includes the horse and seal', () => {
  const text = buildShareText('Docs Smokin Gun', 'SEAL-BA78-16BF-8F01');
  assert.ok(text.includes('Docs Smokin Gun'));
  assert.ok(text.includes('SEAL-BA78-16BF-8F01'));
  assert.ok(/verified by xbar/i.test(text));
  assert.ok(/unaltered/i.test(text));
  assert.ok(!/apprais|guarantee/i.test(text));
});

test('share text falls back gracefully without a name or seal', () => {
  const text = buildShareText('', '');
  assert.ok(text.startsWith('This horse'));
  assert.ok(!text.includes('(seal'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRanchSocialLink, normalizeRanchSocialLinks } from '../src/lib/ranchSocialLinks.js';

test('normalizes supported profile addresses and strips tracking', () => {
  assert.equal(
    normalizeRanchSocialLink('instagram', ' https://www.instagram.com/my_ranch/?utm_source=app#bio '),
    'https://www.instagram.com/my_ranch/',
  );
  assert.equal(normalizeRanchSocialLink('x', 'https://twitter.com/my_ranch'), 'https://twitter.com/my_ranch');
  assert.equal(
    normalizeRanchSocialLink('facebook', 'https://facebook.com/profile.php?id=123&tracking=private'),
    'https://facebook.com/profile.php?id=123',
  );
  assert.equal(normalizeRanchSocialLink('youtube', 'https://youtube.com/@myranch'), 'https://youtube.com/@myranch');
  assert.equal(
    normalizeRanchSocialLink('tiktok', 'https://www.tiktok.com/@myranch'),
    'https://www.tiktok.com/@myranch',
  );
});

test('rejects wrong hosts, unsafe schemes, credentials, posts and commerce targets', () => {
  for (const value of [
    'javascript:alert(1)',
    'http://instagram.com/ranch',
    'https://instagram.com.evil.test/ranch',
    'https://instagram.com@evil.test/ranch',
    'https://evil.test@instagram.com/ranch',
    'https://instagram.com:444/ranch',
    'https://instagram.com/p/123',
    'https://instagram.com/accounts/login',
    'https://instagram.com/',
  ]) {
    assert.throws(() => normalizeRanchSocialLink('instagram', value), value);
  }
  for (const value of [
    'https://facebook.com/marketplace',
    'https://facebook.com/groups/123',
    'https://facebook.com/profile.php',
    'https://facebook.com/dialog/share',
  ])
    assert.throws(() => normalizeRanchSocialLink('facebook', value));
  assert.throws(() => normalizeRanchSocialLink('x', 'https://x.com/ranch/status/1'));
  assert.throws(() => normalizeRanchSocialLink('instagram', 42));
});

test('restores safely, preserves explicit removal, and validates an update atomically', () => {
  assert.deepEqual(normalizeRanchSocialLinks(undefined), {});
  assert.deepEqual(
    normalizeRanchSocialLinks({ instagram: 'javascript:alert(1)', x: 'https://x.com/ranch', facebook: '' }),
    { x: 'https://x.com/ranch' },
  );
  assert.deepEqual(normalizeRanchSocialLinks({ x: '   ', unknown: 'https://evil.test' }, true), {});
  for (const value of [null, 1, [], 'bad']) assert.throws(() => normalizeRanchSocialLinks(value, true));
  assert.throws(() => normalizeRanchSocialLinks({ instagram: 'https://x.com/ranch' }, true), /Instagram/);
});

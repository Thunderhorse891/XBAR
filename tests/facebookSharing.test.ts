import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFacebookShareDialogUrl, buildPublicShareUrl } from '../src/lib/facebookSharing.js';

test('buildPublicShareUrl creates hash route links', () => {
  assert.equal(buildPublicShareUrl('/profiles/horse-wiggy'), '#/profiles/horse-wiggy');
});

test('buildPublicShareUrl appends share token when present', () => {
  assert.equal(buildPublicShareUrl('/profiles/horse-wiggy', 'token-123'), '#/profiles/horse-wiggy?t=token-123');
});

test('buildFacebookShareDialogUrl returns null without app configuration', () => {
  assert.equal(buildFacebookShareDialogUrl('/profiles/horse-wiggy'), null);
});

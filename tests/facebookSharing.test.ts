import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFacebookShareDialogUrl, buildPublicShareUrl } from '../src/lib/facebookSharing.js';

test('buildPublicShareUrl creates hash route links', () => {
  assert.equal(buildPublicShareUrl('/profiles/horse-wiggy'), '#/profiles/horse-wiggy');
});

test('buildFacebookShareDialogUrl returns null without app configuration', () => {
  assert.equal(buildFacebookShareDialogUrl('/profiles/horse-wiggy'), null);
});

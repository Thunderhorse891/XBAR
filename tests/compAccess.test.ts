import assert from 'node:assert/strict';
import test from 'node:test';
import { emailInAllowlist, isCompedEmail } from '../src/lib/compAccess.js';

test('emailInAllowlist matches case-insensitively and trims', () => {
  const list = ['erin@example.com', 'ops@ranch.test'];
  assert.equal(emailInAllowlist('erin@example.com', list), true);
  assert.equal(emailInAllowlist('  ERIN@Example.com ', list), true);
  assert.equal(emailInAllowlist('someone@else.com', list), false);
});

test('emailInAllowlist is false for empty/missing email or empty list', () => {
  assert.equal(emailInAllowlist('', ['a@b.com']), false);
  assert.equal(emailInAllowlist(null, ['a@b.com']), false);
  assert.equal(emailInAllowlist(undefined, ['a@b.com']), false);
  assert.equal(emailInAllowlist('a@b.com', []), false);
});

test('isCompedEmail is false by default (no comp emails configured in tests)', () => {
  // Off-by-default posture: with no VITE_XBAR_COMP_EMAILS set, nobody is comped.
  assert.equal(isCompedEmail('anyone@example.com'), false);
});

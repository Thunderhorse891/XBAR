import assert from 'node:assert/strict';
import test from 'node:test';

import { emailInAllowlist, isCompedEmail, parseCompEmails } from '../../api/_lib/comp-access.js';

test('parseCompEmails splits on commas/space/semicolons and lowercases', () => {
  assert.deepEqual(parseCompEmails('A@B.com, ops@ranch.test'), ['a@b.com', 'ops@ranch.test']);
  assert.deepEqual(parseCompEmails('one@x.com two@y.com;three@z.com'), ['one@x.com', 'two@y.com', 'three@z.com']);
  assert.deepEqual(parseCompEmails(''), []);
  assert.deepEqual(parseCompEmails(undefined), []);
});

test('emailInAllowlist matches case-insensitively', () => {
  assert.equal(emailInAllowlist('Erin@Example.com', ['erin@example.com']), true);
  assert.equal(emailInAllowlist('nope@x.com', ['erin@example.com']), false);
  assert.equal(emailInAllowlist('', ['erin@example.com']), false);
});

test('isCompedEmail reads the XBAR_COMP_EMAILS env allowlist', () => {
  const prev = process.env.XBAR_COMP_EMAILS;
  try {
    delete process.env.XBAR_COMP_EMAILS;
    assert.equal(isCompedEmail('erin@example.com'), false, 'off by default when unset');

    process.env.XBAR_COMP_EMAILS = 'erin@example.com, ops@ranch.test';
    assert.equal(isCompedEmail('erin@example.com'), true);
    assert.equal(isCompedEmail('OPS@RANCH.TEST'), true);
    assert.equal(isCompedEmail('stranger@example.com'), false);
  } finally {
    if (prev === undefined) delete process.env.XBAR_COMP_EMAILS;
    else process.env.XBAR_COMP_EMAILS = prev;
  }
});

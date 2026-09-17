import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPasswordUpdateRequest,
  readPasswordUpdateError,
  runPasswordUpdateWithLock,
} from '../src/lib/passwordUpdateRequest.js';

test('a failure after starting the password operation is never retried', async () => {
  let requests = 0;
  const failure = new Error('post-update processing failed');
  await assert.rejects(
    runPasswordUpdateWithLock(
      async () => {
        requests++;
        throw failure;
      },
      (work) => work(),
      () => {
        throw new Error('Unexpected unavailable callback');
      },
    ),
    (error) => error === failure,
  );
  assert.equal(requests, 1);
});

test('a lock failure after a successful operation cannot repeat it', async () => {
  let requests = 0;
  await assert.rejects(
    runPasswordUpdateWithLock(
      async () => ++requests,
      async (work) => {
        await work();
        throw new Error('lock completion failed');
      },
      () => -1,
    ),
    /lock completion failed/,
  );
  assert.equal(requests, 1);
});

test('failure to acquire a lock sends no password operation', async () => {
  let requests = 0;
  const result = await runPasswordUpdateWithLock(
    async () => ++requests,
    async () => {
      throw new Error('locking unavailable');
    },
    () => -1,
  );
  assert.equal(result, -1);
  assert.equal(requests, 0);
});

test('a busy lock does not start the password operation', async () => {
  let requests = 0;
  const result = await runPasswordUpdateWithLock(
    async () => ++requests,
    async () => -1,
    () => -2,
  );
  assert.equal(result, -1);
  assert.equal(requests, 0);
});

/*
 * The invariant that makes the cross-tab race harmless: the password change is
 * bound to the token the recovery grant was validated against, so a switch
 * elsewhere cannot redirect it. Testable here precisely because the token is an
 * argument -- proving it through the browser would need a race staged across
 * an auth-js lock boundary, which is why re-checking an ambient session was
 * never provable.
 */

const base = { supabaseUrl: 'https://ranch.supabase.co', anonKey: 'anon-key', password: 'a-brand-new-password' };

test('the request carries the token it was given', () => {
  const request = buildPasswordUpdateRequest({ ...base, accessToken: 'token-for-account-a' });
  assert.equal(request.headers.Authorization, 'Bearer token-for-account-a');
  assert.equal(request.method, 'PUT');
  assert.equal(request.url, 'https://ranch.supabase.co/auth/v1/user');
  assert.equal(request.headers.apikey, 'anon-key');
  assert.deepEqual(JSON.parse(request.body), { password: 'a-brand-new-password' });
});

test('two accounts produce two different requests', () => {
  /*
   * The whole point stated as a test: which account is changed follows the
   * token argument and nothing else. A version reaching for ambient state
   * would return the same header for both.
   */
  const a = buildPasswordUpdateRequest({ ...base, accessToken: 'token-a' });
  const b = buildPasswordUpdateRequest({ ...base, accessToken: 'token-b' });
  assert.notEqual(a.headers.Authorization, b.headers.Authorization);
  assert.equal(a.headers.Authorization, 'Bearer token-a');
});

test('a trailing slash on the project URL does not double up', () => {
  const request = buildPasswordUpdateRequest({ ...base, supabaseUrl: 'https://ranch.supabase.co/', accessToken: 't' });
  assert.equal(request.url, 'https://ranch.supabase.co/auth/v1/user');
});

test("GoTrue's own refusal reaches the caller", () => {
  // "New password should be different from the old password" IS the answer the
  // customer needs; replacing it with our own wording removes the only useful
  // part of the response.
  assert.equal(
    readPasswordUpdateError({ code: 422, msg: 'New password should be different from the old password.' }),
    'New password should be different from the old password.',
  );
  assert.equal(readPasswordUpdateError({ error_description: 'token expired' }), 'token expired');
  assert.equal(readPasswordUpdateError({ message: 'gateway said no' }), 'gateway said no');
});

test('an unexplained refusal returns nothing rather than a stand-in', () => {
  /*
   * The caller distinguishes "the server explained itself" from "it did not",
   * and says so differently. Inventing a message here would erase that.
   */
  assert.equal(readPasswordUpdateError({}), '');
  assert.equal(readPasswordUpdateError(null), '');
  assert.equal(readPasswordUpdateError('nope'), '');
  assert.equal(readPasswordUpdateError({ msg: '   ' }), '');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/*
 * The recovery mutation runs its check and its update inside auth-js's own
 * session lock, and reaches for auth-js INTERNALS to do it: the lock itself,
 * and the non-locking session read and user update that must be used inside it
 * (calling the public methods there deadlocks -- `_acquireLock` pushes the
 * outer callback into `pendingInLock` before running it, so a nested call
 * awaits the promise waiting on it).
 *
 * Those names are not part of auth-js's public contract. The code fails closed
 * if they vanish, which is the right behaviour -- but "password reset stops
 * working entirely" is not something to discover from a customer. An upgrade
 * that renames any of them should fail CI here instead.
 */
const auth = createClient('https://internals-check.invalid', 'anon-key').auth;

test('auth-js still exposes the internals the recovery lock depends on', () => {
  for (const name of ['_acquireLock', '_useSession', '_updateUser']) {
    assert.equal(
      typeof auth[name],
      'function',
      `@supabase/auth-js no longer exposes ${name}; updatePassword's session lock cannot work without it`,
    );
  }
  assert.equal(
    typeof auth.lockAcquireTimeout,
    'number',
    'auth-js no longer exposes lockAcquireTimeout; the recovery lock has no timeout to honour',
  );
});

test('the pinned auth-js version is the one this was verified against', () => {
  /*
   * Recorded so a bump is a deliberate act. The deadlock above is a property of
   * _acquireLock's internals, so an upgrade needs the rendered recovery cases
   * re-run, not just a green typecheck.
   */
  const installed = JSON.parse(
    readFileSync(path.join(process.cwd(), 'node_modules/@supabase/auth-js/package.json'), 'utf8'),
  ).version;
  assert.equal(installed, '2.100.1', 'auth-js changed; re-run the rendered recovery suite before accepting the bump');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { hasValidatedPasswordRecovery } from '../src/lib/passwordRecovery.js';

/*
 * Holding a session is not the same fact as holding a validated recovery, and
 * conflating them is how this screen twice came to change a password on a
 * premise nobody had established: first by gating on a session alone, then by
 * letting a grant outlive the session it was issued for.
 */

const session = (id: string) => ({ user: { id } });

test('a session with no recovery grant cannot change a password', () => {
  // The original defect: being signed in was treated as proof of a valid link.
  assert.equal(hasValidatedPasswordRecovery({ session: session('user-a'), passwordRecoveryFor: '' }), false);
});

test('a grant matching the current session authorizes it', () => {
  assert.equal(hasValidatedPasswordRecovery({ session: session('user-a'), passwordRecoveryFor: 'user-a' }), true);
});

test('a grant does not transfer to a different account', () => {
  /*
   * The inherited-authorization case: a recovery session ends (token expiry, a
   * sign-out in another tab) and someone else signs in to the same tab. A bare
   * boolean would still read "recovery in progress" and let that new account's
   * password be changed with nothing validated.
   */
  assert.equal(hasValidatedPasswordRecovery({ session: session('user-b'), passwordRecoveryFor: 'user-a' }), false);
});

test('a grant with no session authorizes nothing', () => {
  assert.equal(hasValidatedPasswordRecovery({ session: null, passwordRecoveryFor: 'user-a' }), false);
});

test('neither a session nor a grant authorizes nothing', () => {
  assert.equal(hasValidatedPasswordRecovery({ session: null, passwordRecoveryFor: '' }), false);
});

test('an empty grant is never satisfied, even by an empty id', () => {
  // Guards against '' == '' quietly authorizing a malformed session.
  assert.equal(hasValidatedPasswordRecovery({ session: session(''), passwordRecoveryFor: '' }), false);
});

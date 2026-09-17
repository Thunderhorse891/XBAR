import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasValidatedPasswordRecovery,
  reconcileStoredRecovery,
  resetScreenState,
  recoveryGrantAdopted,
} from '../src/lib/passwordRecovery.js';

/*
 * Holding a session is not the same fact as holding a validated recovery, and
 * conflating them is how this screen twice came to change a password on a
 * premise nobody had established: first by gating on a session alone, then by
 * letting a grant outlive the session it was issued for.
 */

const session = (id: string) => ({ user: { id } });

/*
 * Grants are named explicitly at every call rather than defaulted, so no case
 * can pass on a default that happens to agree.
 */
const gate = (input: {
  session: { user: { id: string } } | null;
  passwordRecoveryFor: string;
  passwordRecoveryGrant: string;
  sessionGrant: string;
}) => hasValidatedPasswordRecovery(input);

test('a session with no recovery grant cannot change a password', () => {
  // The original defect: being signed in was treated as proof of a valid link.
  assert.equal(
    gate({ session: session('user-a'), passwordRecoveryFor: '', passwordRecoveryGrant: '', sessionGrant: 'gen-1' }),
    false,
  );
});

test('a grant matching the current session authorizes it', () => {
  assert.equal(
    gate({
      session: session('user-a'),
      passwordRecoveryFor: 'user-a',
      passwordRecoveryGrant: 'gen-1',
      sessionGrant: 'gen-1',
    }),
    true,
  );
});

test('a grant does not transfer to a different account', () => {
  /*
   * The inherited-authorization case: a recovery session ends (token expiry, a
   * sign-out in another tab) and someone else signs in to the same tab. A bare
   * boolean would still read "recovery in progress" and let that new account's
   * password be changed with nothing validated.
   */
  assert.equal(
    gate({
      session: session('user-b'),
      passwordRecoveryFor: 'user-a',
      passwordRecoveryGrant: 'gen-1',
      sessionGrant: 'gen-1',
    }),
    false,
  );
});

test('a grant does not survive its session being replaced for the same account', () => {
  /*
   * The account matches, and that used to be the whole test. An ordinary
   * sign-in for the same account overwrites the recovery session auth-js holds
   * without sending SIGNED_OUT or USER_UPDATED, so the marker stays and the
   * screen kept offering a form that `updatePassword` then refused on every
   * submission -- while declining to clear a grant it did not name, so the
   * form never expired either.
   */
  assert.equal(
    gate({
      session: session('user-a'),
      passwordRecoveryFor: 'user-a',
      passwordRecoveryGrant: 'gen-1',
      sessionGrant: 'gen-2',
    }),
    false,
  );
});

test('a refreshed token keeps the same grant and stays authorized', () => {
  /*
   * The reason the comparison is by GENERATION and not by credential: auth-js
   * rotates the access token underneath a session that has not otherwise
   * changed, and the `session_id` claim both tokens carry is unchanged. Were
   * this compared by token, every refresh mid-reset would refuse the customer.
   */
  assert.equal(
    gate({
      session: session('user-a'),
      passwordRecoveryFor: 'user-a',
      passwordRecoveryGrant: 'gen-1',
      sessionGrant: 'gen-1',
    }),
    true,
  );
});

test('an underivable grant falls back to the account check rather than refusing', () => {
  /*
   * A token with no `session_id` claim yields '' on either side. Refusing on an
   * id nobody could derive would make recovery impossible on such a token
   * instead of merely unverified, so the account check still decides -- which
   * is exactly the behaviour that shipped before the grant was compared.
   */
  assert.equal(
    gate({
      session: session('user-a'),
      passwordRecoveryFor: 'user-a',
      passwordRecoveryGrant: '',
      sessionGrant: 'gen-1',
    }),
    true,
  );
  assert.equal(
    gate({
      session: session('user-a'),
      passwordRecoveryFor: 'user-a',
      passwordRecoveryGrant: 'gen-1',
      sessionGrant: '',
    }),
    true,
  );
  assert.equal(
    gate({ session: session('user-b'), passwordRecoveryFor: 'user-a', passwordRecoveryGrant: '', sessionGrant: '' }),
    false,
  );
});

test('a grant with no session authorizes nothing', () => {
  assert.equal(
    gate({ session: null, passwordRecoveryFor: 'user-a', passwordRecoveryGrant: 'gen-1', sessionGrant: '' }),
    false,
  );
});

test('neither a session nor a grant authorizes nothing', () => {
  assert.equal(gate({ session: null, passwordRecoveryFor: '', passwordRecoveryGrant: '', sessionGrant: '' }), false);
});

test('an empty grant is never satisfied, even by an empty id', () => {
  // Guards against '' == '' quietly authorizing a malformed session.
  assert.equal(
    gate({ session: session(''), passwordRecoveryFor: '', passwordRecoveryGrant: '', sessionGrant: '' }),
    false,
  );
});

/*
 * The reset screen's states have to be mutually exclusive, because the events
 * driving them overlap. Completing a reset CLEARS the recovery grant -- that is
 * the point of it -- so "the password was changed" and "there is no valid
 * recovery" become true at the same instant. As four independent booleans in
 * the JSX, both branches rendered: the screen announced "Password updated" and
 * "request another reset link" together, telling the customer their reset had
 * both worked and not.
 */

const base = { supabaseReady: true, done: false, submitting: false, settling: false, recoveryValid: true };

test('a completed reset reads as done, never as an expired link', () => {
  // The reported regression, in the state it actually occurs in: the update
  // succeeded, so `done` is set AND the grant has already been cleared.
  assert.equal(resetScreenState({ ...base, done: true, recoveryValid: false }), 'done');
});

test('a grant clearing mid-request does not become an expired-link error', () => {
  // auth-js broadcasts USER_UPDATED to every tab, so the grant can vanish while
  // the request is still resolving.
  assert.equal(resetScreenState({ ...base, submitting: true, recoveryValid: false }), 'saving');
});

test('a validated recovery shows the form', () => {
  assert.equal(resetScreenState(base), 'form');
});

test('no validated recovery is refused', () => {
  assert.equal(resetScreenState({ ...base, recoveryValid: false }), 'refused');
});

test('an arriving session is not refused before it settles', () => {
  // The link carries the session, so "not yet" must not read as "never".
  assert.equal(resetScreenState({ ...base, settling: true, recoveryValid: false }), 'settling');
});

test('an unconfigured build says so rather than refusing a link', () => {
  assert.equal(resetScreenState({ ...base, supabaseReady: false, recoveryValid: false }), 'unavailable');
  assert.equal(resetScreenState({ ...base, supabaseReady: false, done: true }), 'unavailable');
});

test('every combination resolves to exactly one state', () => {
  /*
   * The property that matters, checked exhaustively rather than by example:
   * the screen is never in two states at once, which is the whole failure.
   */
  const bools = [false, true];
  const seen = new Set<string>();
  for (const supabaseReady of bools)
    for (const done of bools)
      for (const submitting of bools)
        for (const settling of bools)
          for (const recoveryValid of bools) {
            const state = resetScreenState({ supabaseReady, done, submitting, settling, recoveryValid });
            assert.ok(typeof state === 'string' && state.length > 0);
            seen.add(state);
            // 'done' and 'refused' are the pair that rendered together.
            if (done && supabaseReady) assert.equal(state, 'done', 'a finished reset must outrank every other state');
          }
  assert.deepEqual(
    [...seen].sort(),
    ['done', 'form', 'refused', 'saving', 'settling', 'unavailable'],
    'every declared state must be reachable, or one of them is dead code',
  );
});

test('a grant already spent elsewhere does not come back after a reload', () => {
  /*
   * The grant is durable on purpose -- a refresh must not report a valid link
   * as expired -- but the only thing clearing it was USER_UPDATED, a transient
   * broadcast. A tab reloading while another tab completed the reset had no
   * subscriber to hear it, came back holding the grant and a session for the
   * same user, and could set the password again with no new link.
   */
  assert.equal(reconcileStoredRecovery({ storedGrant: 'user-a', spentFor: 'user-a' }), '');
});

test('a grant already spent for any earlier account does not come back', () => {
  /*
   * A single durable slot let a later reset for B overwrite the revocation for
   * A. An unloaded A tab could then reload, sign in as A, and reuse its old
   * grant without a new link.
   */
  assert.equal(reconcileStoredRecovery({ storedGrant: 'user-a', spentFor: ['user-b', 'user-a'] }), '');
});

test('a grant survives a completion recorded for a different account', () => {
  assert.equal(reconcileStoredRecovery({ storedGrant: 'user-a', spentFor: 'user-b' }), 'user-a');
});

test('a grant survives when nothing has been spent', () => {
  // The ordinary reload, which must still find its link valid.
  assert.equal(reconcileStoredRecovery({ storedGrant: 'user-a', spentFor: '' }), 'user-a');
});

test('no grant stays no grant', () => {
  assert.equal(reconcileStoredRecovery({ storedGrant: '', spentFor: '' }), '');
  assert.equal(reconcileStoredRecovery({ storedGrant: '', spentFor: 'user-a' }), '');
});

/*
 * Attempt-local failure state on the reset screen must not outlive the link it
 * belongs to. auth-js broadcasts PASSWORD_RECOVERY to every tab and this store
 * ADOPTS it, so a link validated elsewhere makes the screen usable again --
 * while a stale `unexpectedFailure` from the previous attempt went on hiding
 * the form, leaving the customer reading an uncertainty message about a link
 * that had already been replaced.
 */

test('a newly adopted grant counts as adoption', () => {
  assert.equal(recoveryGrantAdopted('grant-a', 'grant-b'), true);
  assert.equal(recoveryGrantAdopted('', 'grant-a'), true, 'the first link this screen sees counts too');
});

test('the same grant is not a new adoption', () => {
  // Otherwise every unrelated re-render would clear a warning about the attempt
  // that is still in front of the customer.
  assert.equal(recoveryGrantAdopted('grant-a', 'grant-a'), false);
});

test('a RELEASED grant is not an adoption', () => {
  /*
   * Clearing to '' is how a spent or revoked grant is released -- including by
   * the very failure the warning describes. Treating that as adoption would
   * erase the message at the moment it matters most.
   */
  assert.equal(recoveryGrantAdopted('grant-a', ''), false);
  assert.equal(recoveryGrantAdopted('', ''), false);
});

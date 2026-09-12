/**
 * Whether a session is the one a password-recovery link was validated for.
 *
 * Holding a session and holding a validated recovery are different facts, and
 * only their intersection may change a password. Keeping that comparison in
 * one pure function is what stops the two being conflated again -- an earlier
 * revision gated on a session alone, so an expired link let whoever was signed
 * in change their password on a premise nobody had established.
 *
 * The session is typed structurally rather than as Supabase's Session so this
 * stays free of the client, and therefore testable on its own.
 */
export type RecoveryGateState = {
  session: { user: { id: string } } | null;
  /** The user id Supabase validated a recovery for, or '' for none. */
  passwordRecoveryFor: string;
  /**
   * The grant id the validated link was recorded under, or '' when the link's
   * token carried no `session_id` claim to derive one from.
   */
  passwordRecoveryGrant: string;
  /** The same id for the session held right now, or '' when not derivable. */
  sessionGrant: string;
};

/**
 * The grant a tab may still hold at startup, after accounting for one already
 * spent elsewhere.
 *
 * The grant is deliberately durable -- it survives a reload so a refresh does
 * not report a valid link as expired -- but the only thing that used to clear
 * it was USER_UPDATED, which is a transient broadcast. A tab that was reloading
 * or navigating while another tab completed the reset had no subscriber to
 * receive it, came back, read its still-present grant and a session for the
 * same user, and could set the password again with no new link. A durable
 * grant needs a durable revocation.
 *
 * A later, genuine recovery for the same account clears the spent mark when
 * Supabase validates it, so this only ever retires a grant that has actually
 * been used.
 */
export function reconcileStoredRecovery(input: { storedGrant: string; spentFor: string | readonly string[] }): string {
  if (!input.storedGrant) return '';
  const spentFor = Array.isArray(input.spentFor) ? input.spentFor : [input.spentFor];
  return spentFor.includes(input.storedGrant) ? '' : input.storedGrant;
}

/**
 * Matching the account is necessary and was treated as sufficient.
 *
 * A recovery is validated against ONE session, and an ordinary sign-in for the
 * same account replaces that session without ending the grant: auth-js keeps a
 * single stored session, so signing in from another tab overwrites the
 * recovery one, and the only events that clear the marker are SIGNED_OUT and
 * USER_UPDATED -- neither of which a plain sign-in sends. The account still
 * matched, so the screen went on showing an authorized reset form.
 *
 * It was a form that could never work. `updatePassword` derives the grant of
 * the session it actually holds and finds the account marker still naming the
 * recovery generation, so `isRecoveryGrantSpent` reports the link as used and
 * every submission comes back "This reset link has already been used" -- and
 * the marker release deliberately declines to clear a grant it does not name,
 * so nothing retires the form either. The customer is left on a live-looking
 * page that refuses them in a loop, with the one instruction that would help
 * (request another link) attached to a message telling them their link was
 * already spent.
 *
 * So the grant is compared as well as the account. Generations survive token
 * refresh -- the id comes from the `session_id` claim, which rotation does not
 * change -- so this closes on a REPLACED session, not a refreshed one.
 *
 * Both ids must be known to disagree. A token without a `session_id` claim
 * yields '' for either side, and refusing on an id nobody could derive would
 * make recovery impossible on such a token rather than merely unverified; the
 * account check still applies there, exactly as before.
 */
export function hasValidatedPasswordRecovery(state: RecoveryGateState): boolean {
  const grantedTo = state.passwordRecoveryFor;
  if (!grantedTo) return false;
  // A grant that outlived its session must not transfer to the next one.
  if (state.session?.user.id !== grantedTo) return false;
  if (state.passwordRecoveryGrant && state.sessionGrant && state.passwordRecoveryGrant !== state.sessionGrant) {
    return false;
  }
  return true;
}

/**
 * Whether a NEWER recovery link has been adopted since the last one this screen
 * acted on.
 *
 * The reset screen keeps attempt-local failure state: an aborted request or a
 * 5xx sets `unexpectedFailure`, which suppresses the form deliberately, because
 * the server may have applied the change and offering an immediate repeat would
 * invite a second one.
 *
 * That state was per-mount and never cleared. auth-js broadcasts
 * PASSWORD_RECOVERY to every tab and this store ADOPTS it, so a link validated
 * in another tab makes this screen's state say `form` again -- while the stale
 * `unexpectedFailure` from the previous attempt went on hiding it. The customer
 * was left looking at an uncertainty message about a link that had already been
 * replaced, unable to use the new one from this tab, and the grant-preserving
 * work that keeps newer links alive could not be reached from here.
 *
 * Compared by GRANT, not by account: the account does not change when one link
 * replaces another, which is precisely the case this exists for. An empty next
 * grant is not an adoption -- that is a release, and it must not clear a
 * warning about the attempt that caused it.
 */
export function recoveryGrantAdopted(previousGrant: string, nextGrant: string): boolean {
  return Boolean(nextGrant) && nextGrant !== previousGrant;
}

/**
 * The single state the reset screen is in.
 *
 * These were four independent boolean expressions in the JSX, and independent
 * booleans do not add up to exclusive states. A successful update clears the
 * recovery grant -- that is the point of it -- which flipped the "no valid
 * recovery" condition true at the same moment the success condition became
 * true, so the screen simultaneously announced "Password updated" and "This
 * page needs a current password-reset link ... request another". The customer
 * was told their reset both worked and had not.
 *
 * The same shape had a second failure in it: the grant can also clear WHILE a
 * request is in flight (auth-js broadcasts USER_UPDATED to every tab), which
 * would raise the expired-link alert mid-submission.
 *
 * So the screen now asks one question and renders one answer. Order is the
 * meaning: a finished reset outranks everything, an in-flight one is never
 * "refused", and only after those does a missing grant mean refusal.
 */
export type ResetScreenState =
  | 'unavailable' // No cloud auth in this build; there is no password to set.
  | 'done' // The password was changed.
  | 'saving' // A request is in flight; the grant may clear underneath it.
  | 'settling' // The link's session may still be arriving; do not refuse yet.
  | 'form' // A validated recovery is held: show the form.
  | 'refused'; // No validated recovery.

export type ResetScreenInput = {
  supabaseReady: boolean;
  done: boolean;
  submitting: boolean;
  settling: boolean;
  recoveryValid: boolean;
};

export function resetScreenState(input: ResetScreenInput): ResetScreenState {
  if (!input.supabaseReady) return 'unavailable';
  // Ahead of everything else: once the password is changed the grant is gone
  // by design, and reading that absence as a dead link is what went wrong.
  if (input.done) return 'done';
  // A grant cleared mid-request must not become an expired-link error.
  if (input.submitting) return 'saving';
  if (input.settling) return 'settling';
  return input.recoveryValid ? 'form' : 'refused';
}

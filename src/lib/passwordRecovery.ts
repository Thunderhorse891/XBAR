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
};

export function hasValidatedPasswordRecovery(state: RecoveryGateState): boolean {
  const grantedTo = state.passwordRecoveryFor;
  if (!grantedTo) return false;
  // A grant that outlived its session must not transfer to the next one.
  return state.session?.user.id === grantedTo;
}

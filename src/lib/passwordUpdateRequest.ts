/**
 * The password change, expressed as a request bound to one specific token.
 *
 * `auth.updateUser()` acts on auth-js's AMBIENT session, which it rereads
 * inside its own lock. Checking the session first does not constrain it: the
 * check and the mutation are separate lock acquisitions, the lock is released
 * and retaken between them, and a cross-tab account switch queued behind the
 * first one lands in the gap. Adjacent statements are not an atomic operation.
 *
 * So the account is not re-checked here -- it is CARRIED. The access token of
 * the session the recovery grant was validated against is an argument, and the
 * server applies the change to whoever that token belongs to. A switch
 * elsewhere can change what auth-js holds; it cannot change what was sent. The
 * account that gets a new password is the account the emailed link was issued
 * for, which is the property the customer is owed.
 *
 * Building the request separately from sending it is what makes that testable:
 * the token is an input, so a version that reached for ambient state instead
 * fails a test rather than needing a race to be staged in a browser.
 */
export type PasswordUpdateRequest = {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  body: string;
};

export function buildPasswordUpdateRequest(input: {
  supabaseUrl: string;
  anonKey: string;
  /** The access token of the session the grant was validated against. */
  accessToken: string;
  password: string;
}): PasswordUpdateRequest {
  return {
    url: `${input.supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`,
    method: 'PUT',
    headers: {
      apikey: input.anonKey,
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: input.password }),
  };
}

/**
 * GoTrue's own words for a refusal, or nothing.
 *
 * Returning '' rather than a stand-in matters: the caller distinguishes "the
 * server explained itself" from "it did not", and inventing a message here
 * would erase that difference. `msg` is GoTrue's field; the others cover
 * gateways and older shapes.
 */
export function readPasswordUpdateError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const body = payload as Record<string, unknown>;
  for (const key of ['msg', 'error_description', 'message', 'error']) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

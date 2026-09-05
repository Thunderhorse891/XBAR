import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/*
 * The login screen must not offer a route it cannot complete, and must not
 * report an outcome that did not happen.
 *
 * Both rules were broken at once on the live site. Google, Facebook and Apple
 * buttons rendered whenever Supabase was configured at all, while the Supabase
 * project had no provider enabled -- so every one of them answered with HTTP
 * 400 "Unsupported provider: provider is not enabled", and the only sign of it
 * was a toast in the corner. Meanwhile signup read only `error` from
 * `auth.signUp`, and Supabase deliberately does not error for an address that
 * already exists: it returns "an obfuscated user response with no verification
 * email sent". So the screen said "Account created. Check your inbox if email
 * confirmation is required" about an email nobody had sent, and the owner of
 * the account spent days waiting for it.
 *
 * These are source guards because the failures live in JSX and in a zustand
 * store, where a unit test cannot reach them. What each one protects is a
 * property, not a spelling: a button exists only if configuration says the
 * provider works, and a claim is made only about something that happened.
 */

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const read = (file) => stripComments(readFileSync(path.join(process.cwd(), file), 'utf8'));

const login = read('src/routes/Login.tsx');
const store = read('src/store/useCloudStore.ts');

function body(source, signature, label) {
  const match = source.match(signature);
  assert.ok(match, `could not find ${label} -- this guard is reading stale structure and proves nothing`);
  return match[0];
}

test('no sign-in button is rendered from a hardcoded provider list', () => {
  // The literal that shipped. Rendering from a constant means the buttons no
  // longer have any relationship to what Supabase will actually accept.
  assert.equal(
    /\[\s*'google'\s*,\s*'facebook'\s*,\s*'apple'\s*\]/.test(login),
    false,
    'Login.tsx renders a fixed provider list again; it must render only configured providers',
  );
  assert.match(login, /presentableOAuthProviders/, 'Login.tsx must source its providers from configuration');
  assert.match(login, /oauthProviders\.map\(/, 'the button row must be drawn from the configured list');
});

test('the provider row is gated on there being a configured provider', () => {
  // Being configured for Supabase is not evidence that any provider is enabled
  // in it -- that was precisely the wrong condition.
  assert.match(
    login,
    /oauthProviders\.length > 0 &&/,
    'the OAuth block must be conditional on the configured list being non-empty',
  );
});

test('every auth outcome is written into the form, not only into a toast', () => {
  const report = body(login, /const report = \([\s\S]*?\n {2}\};/, 'the report() helper in Login.tsx');
  assert.match(report, /pushToast\(/, 'report() must still raise a toast');
  assert.match(report, /setFormMessage\(/, 'report() must also place the message in the form');

  // Nothing may hand an auth result straight to a toast and skip the form: a
  // toast is transient and off to one side, which is how a rejected password
  // came to look like a button that does nothing.
  const elsewhere = login.replace(report, '');
  assert.equal(
    /result\.message/.test(elsewhere),
    false,
    'an auth result is reported outside report(), so it can reach a toast without reaching the form',
  );
});

test('the form renders the message it was given', () => {
  assert.match(login, /className=\{`clean-auth-message/, 'the inline message element must exist');
  assert.match(login, /role=\{formMessage\.tone === 'error' \? 'alert' : 'status'\}/, 'errors must be announced');
});

test('signup reads the response body, not only the error', () => {
  const signup = body(store, /signUpWithPassword: async[\s\S]*?\n {2}\},/, 'signUpWithPassword');
  assert.match(
    signup,
    /const \{ data, error \} = await client\.auth\.signUp/,
    'signUpWithPassword must inspect data; Supabase reports the already-registered case there, not in error',
  );
  assert.match(signup, /data\.session/, 'only a session proves an account was created and usable');
  assert.match(signup, /identities/, 'the obfuscated existing-account response must be detected');
});

test('signup distinguishes the three things that can happen', () => {
  const signup = body(store, /signUpWithPassword: async[\s\S]*?\n {2}\},/, 'signUpWithPassword');
  for (const outcome of ["'signed-in'", "'confirmation-required'", "'existing-account'"]) {
    assert.ok(signup.includes(outcome), `signUpWithPassword no longer reports ${outcome}`);
  }
});

test('no auth path claims an email was delivered', () => {
  // Supabase answers identically whether or not it sent anything, for both
  // signup and recovery. Neither may be described to the customer as a
  // delivery that occurred.
  assert.equal(
    store.includes('Account created. Check your inbox if email confirmation is required.'),
    false,
    'signup claims a confirmation email that Supabase may never have sent',
  );
  const reset = body(store, /sendPasswordReset: async[\s\S]*?\n {2}\},/, 'sendPasswordReset');
  assert.equal(
    /message: 'Password reset email sent\.'/.test(reset),
    false,
    'sendPasswordReset claims a delivery; Supabase answers the same for an unknown address',
  );
});

test('a password reset can actually be completed', () => {
  /*
   * The half that did not exist. `resetPasswordForEmail` sent the mail and,
   * because the Supabase client runs with `detectSessionInUrl`, opening the
   * link signed the customer in -- so the flow looked finished while the
   * password was untouched. Nothing in src/ called `auth.updateUser`, and the
   * borrowed session expires, so the customer was locked out again having been
   * told the reset worked.
   */
  assert.match(
    store,
    /client\.auth\.updateUser\(\{ password \}\)/,
    'nothing sets a new password; a reset that only sends mail cannot complete',
  );
  assert.match(
    store,
    /event === 'PASSWORD_RECOVERY'/,
    'the recovery event must be distinguished from an ordinary sign-in',
  );
});

test('the recovery email points at the screen that can finish the job', () => {
  const reset = body(store, /sendPasswordReset: async[\s\S]*?\n {2}\},/, 'sendPasswordReset');
  // currentAuthRedirectUrl() returns the page the request came FROM, so the
  // link used to land back on the login form with nothing left to do.
  assert.equal(
    /redirectTo = currentAuthRedirectUrl\(\)/.test(reset),
    false,
    'the reset link returns to the requesting page, which cannot set a password',
  );
  assert.match(reset, /appRouteUrl\(passwordResetPath\)/, 'the reset link must target the reset screen');
});

test('the reset screen is routed and reachable without an existing session', () => {
  const app = read('src/App.tsx');
  assert.match(app, /path=\{passwordResetPath\}/, 'the reset route must be registered');
  // It must NOT sit behind RequireCloudAuth: the session arrives in the link
  // itself, and a guard would bounce the arrival to /login before it settles.
  const route = app.match(/<Route path=\{passwordResetPath\}[\s\S]{0,200}?\/>/);
  assert.ok(route, 'could not read the reset route');
  assert.equal(
    /RequireCloudAuth/.test(route[0]),
    false,
    'the reset route must not be auth-guarded; the recovery link carries the session',
  );
});

test('one rule decides which router shape a link is built for', () => {
  // App.tsx and main.tsx each had their own copy of this before, and a third
  // for the recovery email is how copies start to disagree.
  for (const file of ['src/App.tsx', 'src/main.tsx']) {
    const source = read(file);
    assert.match(source, /usesHashRouting/, `${file} must use the shared routing rule`);
    assert.equal(
      /VITE_ROUTER_MODE/.test(source),
      false,
      `${file} re-derives the routing mode instead of calling the shared rule`,
    );
  }
});

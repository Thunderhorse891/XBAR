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
const app = read('src/App.tsx');
const authCallbackArrival = read('src/lib/authCallbackArrival.ts');

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
    /buildPasswordUpdateRequest\(\{/,
    'nothing sets a new password; a reset that only sends mail cannot complete',
  );
  assert.match(store, /await fetch\(request\.url/, 'the password request must actually be sent');
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
  assert.match(reset, /authRedirectUrl\(passwordResetPath\)/, 'the reset link must target the reset screen');
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

test('the native recovery link targets the reset screen, not a bare origin', () => {
  /*
   * VITE_PUBLIC_APP_URL is deliberately an ORIGIN with no path -- a '/app'
   * suffix on it once broke the verify links in api/sale-packets.js -- so
   * emailing that origin sends a native customer to the marketing homepage,
   * which is static HTML that never mounts the router. They would still have
   * no way to set a password, and nothing would report a fault.
   */
  const reset = body(store, /sendPasswordReset: async[\s\S]*?\n {2}\},/, 'sendPasswordReset');
  assert.match(
    reset,
    /publicAppRouteUrl\(passwordResetPath, nativePublicOrigin\)/,
    'the native branch must build a path onto the public origin, not send the origin itself',
  );
});

test('a recovery arrival is carried to the reset screen by the app, not the URL', () => {
  /*
   * The link cannot always name the screen: on the hash router the route and
   * Supabase's implicit-flow session would have to share one fragment. So the
   * app has to make that move itself once PASSWORD_RECOVERY fires -- which is
   * also the more robust place for it, since it depends on the auth event
   * rather than on a URL composed earlier by a possibly different build.
   */
  const app = read('src/App.tsx');
  assert.match(app, /function PasswordRecoveryRedirect/, 'the recovery navigation must exist');
  assert.match(app, /<PasswordRecoveryRedirect \/>/, 'it must be rendered inside the router');
  assert.match(
    app,
    /navigate\(passwordResetPath, \{ replace: true \}\)/,
    'it must send the customer to the reset screen',
  );
});

test('an auth email link never claims the fragment Supabase needs', () => {
  const routes = read('src/lib/routeCanon.ts');
  const fn = body(routes, /export function authRedirectUrl[\s\S]*?\n\}/, 'authRedirectUrl');
  // The hash branch must return a shell URL, not a routed one.
  assert.equal(
    /\/#\$\{route\}/.test(fn),
    false,
    'the hash branch puts the route in the fragment, where the session also lands',
  );
});

test('a session alone does not unlock the password form', () => {
  /*
   * Gating on `session` meant anyone already signed in who reached this screen
   * -- via an expired or reused recovery link, or by navigating -- got a
   * working form that changed the password of whatever account was signed in.
   * A dead link would have succeeded quietly against the wrong premise.
   */
  const screen = read('src/routes/ResetPassword.tsx');
  assert.match(
    screen,
    /hasValidatedPasswordRecovery/,
    'the gate must compare the grant against the current session, not read a bare flag',
  );
  assert.match(screen, /recoveryValid: recoveryPending/, 'the validated recovery must feed the screen state');

  /*
   * The screen must render from ONE state. Independent booleans let the success
   * and refusal branches render together -- completing a reset clears the grant,
   * so "done" and "no valid recovery" became true at the same instant and the
   * customer was told the reset both worked and had not.
   */
  assert.match(screen, /const screen = resetScreenState\(/, 'the screen must derive a single state');
  assert.equal(
    /canSubmit/.test(screen),
    false,
    'canSubmit is back: the branches are independent booleans again, which is how they overlapped',
  );
});

test('the recovery subscriber is registered before anything is awaited', () => {
  /*
   * PASSWORD_RECOVERY is one-shot and is scheduled by the URL detection that
   * getSession() waits on. Subscribing after it -- and after a workspace
   * network round trip -- lets the notification fire with nobody listening.
   */
  const initialize = body(store, /initialize: async[\s\S]*?\n {2}\},/, 'initialize');
  const subscribeAt = initialize.indexOf('onAuthStateChange');
  const getSessionAt = initialize.indexOf('await client.auth.getSession()');
  assert.ok(subscribeAt > -1 && getSessionAt > -1, 'could not locate both calls');
  assert.ok(
    subscribeAt < getSessionAt,
    'onAuthStateChange must be registered before getSession, or the one-shot recovery event can be missed',
  );
});

test('recovery is never inferred from the URL, which the visitor controls', () => {
  /*
   * A previous revision read `type=recovery` off the URL as a timing-robust
   * fallback. It was forgeable: any signed-in customer opening
   * /reset-password?type=recovery would have marked their own live session
   * recovery-authorized with Supabase having validated nothing -- reopening the
   * hole that gating on this flag exists to close. Only PASSWORD_RECOVERY, which
   * Supabase emits after validating the callback, may set it.
   */
  const initialize = body(store, /initialize: async[\s\S]*?\n {2}\},/, 'initialize');
  const code = initialize.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(
    /window\.location\.(hash|search)/.test(code),
    false,
    'the recovery flag must not be derived from the URL; it is attacker-supplied',
  );
  assert.match(code, /event === 'PASSWORD_RECOVERY'/, 'only the validated Supabase event may set it');
});

test('the tab-arrival signal cannot become an authorization signal', () => {
  /*
   * Only the tab that opened the recovery link navigates to the reset screen --
   * auth-js broadcasts PASSWORD_RECOVERY to every tab, and without this every
   * open tab yanked itself there, unmounting whatever was in progress.
   *
   * That check reads the URL, which is exactly what this flow was burned by
   * once: a previous revision derived the GRANT from `type=recovery` and any
   * signed-in customer could forge it. The separation is the whole safety
   * argument, so it is pinned rather than trusted -- the store, which owns the
   * grant, must not be able to see this module at all.
   */
  // The CONDITION, not merely the symbol: asserting the call appears anywhere
  // in the file passes with it computed and then ignored, which is how this
  // guard first read while the redirect still fired in every tab.
  assert.match(
    app,
    /if \(!pending \|\| !consumeRecoveryCallbackNavigation\(\)\) return;/,
    'the redirect must consume the tab-local link arrival intent before navigating',
  );
  assert.equal(
    /authCallbackArrival/.test(store),
    false,
    'the store owns the recovery grant and must never see the URL-derived arrival signal',
  );
});

test('an auth event during bootstrap is kept rather than dropped', () => {
  /*
   * The subscriber runs before getSession() resolves, and every event arriving
   * in that window used to be discarded. A sign-out in another tab was then
   * overwritten by the in-flight bootstrap result, leaving the app showing a
   * workspace the customer had signed out of.
   */
  const initialize = body(store, /initialize: async[\s\S]*?\n {2}\},/, 'initialize');
  assert.match(initialize, /bootstrapEventDisposition/, 'the drop-everything guard must not return');
  assert.equal(
    /if \(!bootstrapped\) return;/.test(initialize),
    false,
    'dropping every pre-bootstrap event is the defect this replaced',
  );
  assert.match(initialize, /queuedDuringBootstrap/, 'a contradicting event has to be kept');
  assert.match(initialize, /takeQueuedEvent\(\)/, 'and replayed once the first sync has finished');
});

test('a stale session sync cannot commit over a newer one', () => {
  /*
   * syncSessionState is started without being awaited and the two shapes do
   * not take the same time: signed-out writes at once, signed-in first loads a
   * workspace over the network. Without a gate the winner is whichever
   * FINISHES last, so a sign-out was undone by the sign-in it replaced.
   */
  const initialize = body(store, /initialize: async[\s\S]*?\n {2}\},/, 'initialize');
  assert.match(initialize, /createLatestWriteGate\(\)/, 'session syncs must be ordered by arrival, not by latency');
  assert.match(
    initialize,
    /const accessProfile = await loadWorkspaceAccessProfile\(session\);\s*if \(!isStillLatest\(\)\)/,
    'the check has to sit between the awaited load and the write, or it guards nothing',
  );
});

test('a durable grant has a durable revocation', () => {
  /*
   * The grant survives a reload on purpose. Its only clearer was USER_UPDATED,
   * which is a transient broadcast -- a tab reloading while another completed
   * the reset never heard it and came back able to reuse a spent grant.
   */
  assert.match(store, /RECOVERY_SPENT_KEY/, 'a completed recovery has to be recorded where a reload can see it');
  assert.match(
    store,
    /reconcileStoredRecovery\(\{/,
    'startup must reconcile the stored grant against a recorded completion',
  );
  assert.match(store, /recordSpentRecoveryUser\(session\.user\.id/, 'the completed account must be recorded durably');
  // A later genuine link must clear that account's mark, or one reset would bar
  // every future one for that account. Other accounts' revocations survive.
  const initialize = body(store, /initialize: async[\s\S]*?\n {2}\},/, 'initialize');
  const recoveryEventIndex = initialize.indexOf("event === 'PASSWORD_RECOVERY'");
  const clearCurrentAccountIndex = initialize.indexOf('clearSpentRecoveryUser(session.user.id');
  assert.ok(
    recoveryEventIndex >= 0 && clearCurrentAccountIndex > recoveryEventIndex,
    "a newly validated link must supersede that account's earlier completion without wiping the others",
  );
  assert.match(store, /normalizeRecoveryUsers/, 'durable revocations must preserve more than the most recent account');
});

test('queueing a newer event retires the bootstrap sync in flight', () => {
  /*
   * Queueing does not start a sync, so without this the bootstrap sync keeps
   * its ticket and commits the obsolete session and workspace before the
   * replay begins -- long enough for reconciliation to start on the wrong
   * account.
   */
  const initialize = body(store, /initialize: async[\s\S]*?\n {2}\},/, 'initialize');
  assert.match(
    initialize,
    /queuedDuringBootstrap = \{ session \};[\s\S]{0,80}syncGate\.retireInFlight\(\);/,
    'the in-flight bootstrap sync must be retired as the event is queued',
  );
});

test('the account about to be changed is confirmed against the live session', () => {
  /*
   * The screen's gate compares the grant against the store's `session`, which
   * is a COPY written after a network round trip, while auth-js saves a new
   * session the moment one arrives. So a different account signing in in
   * another tab left a window where the form was still enabled on the old
   * session and updateUser would have changed the NEW account's password.
   *
   * The check and mutation have to share auth-js's own session lock, without
   * nesting public auth methods that take the same lock again.
   */
  const update = body(store, /updatePassword: async[\s\S]*?\n {2}\},/, 'updatePassword');
  assert.match(
    update,
    /accessToken: recoverySession\.access_token/,
    'the request must carry the token of the session the grant was validated against',
  );
  assert.equal(
    /client\.auth\.updateUser\(/.test(update),
    false,
    'updateUser acts on the ambient session; that is the defect, not the fix',
  );
  /*
   * And NOT by holding auth-js's session lock around the check and the
   * mutation. auth-js only uses a real lock when `navigator.locks` exists and
   * otherwise selects `lockNoOp`, which runs the callback with no exclusion at
   * all -- and this build targets safari13 (vite.config.ts), so that fallback
   * ships. A lock that is absent on a supported browser cannot carry a
   * correct-account invariant.
   */
  assert.equal(
    /_acquireLock|withAuthSessionLock/.test(store),
    false,
    "auth-js's lock is a no-op without navigator.locks; the invariant must not depend on it",
  );
});

test('a recovery password update is claimed before it reaches GoTrue', () => {
  /*
   * Carrying the validated token fixes the wrong-account mutation, but removing
   * auth-js from the mutation path also removes its serialization. Two tabs
   * holding the same grant must not both reach GoTrue with different
   * passwords; the grant is reserved before the PUT can leave this browser.
   */
  const update = body(store, /updatePassword: async[\s\S]*?\n {2}\},/, 'updatePassword');
  assert.match(store, /RECOVERY_UPDATE_CLAIM_PREFIX/, 'recovery updates need a per-account in-flight claim');
  assert.match(
    store,
    /writeRecoveryUpdateClaim\(claim\);[\s\S]*await delay\(RECOVERY_UPDATE_CLAIM_SETTLE_MS\)[\s\S]*owned\?\.token !== claim\.token/,
    'claiming must write then re-read ownership before any password request can proceed',
  );
  assert.match(
    update,
    /const recoveryGrant = recoveryGrantToken\(recoverySession\);[\s\S]*?const claim = await claimRecoveryUpdate\(recoverySession\.user\.id, recoveryGrant\);[\s\S]*?if \(!claim\.ok\)[\s\S]*?let response: Response;[\s\S]*?response = await fetch\(/,
    'the recovery grant must be claimed before the PUT reaches GoTrue',
  );
  assert.match(
    update,
    /const stopRenewingClaim = startRecoveryUpdateClaimRenewal\(claim\.claim\);[\s\S]*?try \{\s*response = await fetch\(/,
    'a live password request must keep renewing its claim so another tab cannot steal it after the TTL',
  );
  assert.match(
    update,
    /clearRecoveryUpdateClaim\(claim\.claim\);[\s\S]*?return \{[\s\S]*?message: explained/,
    'an explicit GoTrue refusal must release the claim so the customer can choose a different password',
  );
  assert.match(
    update,
    /completeRecoveryUpdateClaim\(claim\.claim\)/,
    'a successful or uncertain in-flight update must durably spend the grant',
  );
});

test('recovery completion is bound to the validated link', () => {
  /*
   * A user can request another reset email for the same account while an older
   * password PUT is still in flight. When the older request later settles, its
   * completion must not overwrite the fresh link's active state with a
   * user-only spent marker.
   */
  const initialize = body(store, /initialize: async[\s\S]*?\n {2}\},/, 'initialize');
  assert.match(store, /RECOVERY_GRANT_KEY/, 'the validated link needs a tab-local grant identity');
  assert.match(
    initialize,
    /const grantToken = recoveryGrantToken\(session\);[\s\S]*?storeRecoveryUser\(session\.user\.id, grantToken\);[\s\S]*?clearSpentRecoveryUser\(session\.user\.id, grantToken\)/,
    'a fresh PASSWORD_RECOVERY event must mark that specific link active',
  );
  assert.match(
    store,
    /function completeRecoveryUpdateClaim\(claim: RecoveryUpdateClaim\) \{[\s\S]*?recordSpentRecoveryUser\(claim\.userId, claim\.grantToken\)/,
    'completion must spend the grant that submitted, not every link for that account',
  );
  assert.match(
    store,
    /function isRecoveryGrantSpent\(userId: string, grantToken: string\): boolean \{[\s\S]*?marker\?\.state === 'active'[\s\S]*?marker\?\.state === 'spent'[\s\S]*?recoveryMarkerAppliesToGrant/,
    'spent checks must compare the durable marker with the current grant',
  );
});

test('a revoked recovery generation stays revoked', () => {
  /*
   * The per-account marker is one slot, so it only ever remembers the last
   * thing that happened: after link A was spent and then link B was spent, it
   * said "spent, B" -- which rejects B and says nothing about A. A tab still
   * holding A came back to a marker that no longer revoked it.
   *
   * Revocations accumulate in their own permanent per-grant keys. The account
   * marker keeps the one thing only it can say: a sign-out ends every grant for
   * the account, and a newly validated link clears it.
   */
  assert.match(
    store,
    /function isRecoveryGrantSpent\(userId: string, grantToken: string\): boolean \{[\s\S]*?if \(isSpentRecoveryGrant\(userId, grantToken\)\) return true;/,
    'an earlier grant must stay revoked after a later one is spent',
  );
  assert.match(
    store,
    /function completeRecoveryUpdateClaim\(claim: RecoveryUpdateClaim\) \{[\s\S]*?recordSpentRecoveryGrant\(claim\.userId, claim\.grantToken\);/,
    'completion must write a permanent record for the grant it consumed',
  );
  /*
   * And the identifier never falls back to something a refresh changes.
   * supabaseClient.ts enables autoRefreshToken, so `iat`/`exp` drift
   * mid-recovery; an identifier that drifts is worse than none, because the
   * record of what was consumed stops matching and a spent link reads as
   * unused. With no session_id the grant is handled account-wide instead.
   */
  assert.match(
    store,
    /const sessionId = typeof claims\.session_id === 'string' \? claims\.session_id : '';\s*if \(!sessionId\) return '';/,
    'a grant identifier must not be derived from claims a token refresh changes',
  );
  assert.equal(
    /stableRecoveryGrantId\(`\$\{subject\}:\$\{sessionId\}:/.test(store),
    false,
    'nothing but the session may enter the grant identifier',
  );
});

test('recovery exclusion uses a real lock where the browser has one', () => {
  /*
   * The durable claim is best effort and cannot be otherwise: localStorage has
   * no compare-and-set, so write-yield-re-read narrows the race without closing
   * it -- a tab that pauses between reading and writing can still acquire an
   * apparent second ownership. Web Locks close it, and exist everywhere this
   * ships except safari13 (vite.config.ts), where the claim carries it.
   */
  const update = body(store, /updatePassword: async[\s\S]*?\n {2}\},/, 'updatePassword');
  assert.match(
    update,
    /return withRecoveryUpdateExclusion\(\s*recoverySession\.user\.id,/,
    'the update must run under a real lock wherever the browser has one',
  );
  assert.match(
    store,
    /locks\.request\(`\$\{RECOVERY_UPDATE_LOCK_PREFIX\}\$\{userId\}`, \{ ifAvailable: true \}/,
    'a second tab must be told the link is in use, not queued behind a request it cannot see',
  );
  /*
   * And the cross-tab release does not wait on another renderer's write to
   * become visible here: requiring the durable record to confirm the
   * announcement dropped the release about one run in four.
   */
  const initialize = body(store, /initialize: async[\s\S]*?\n {2}\},/, 'initialize');
  assert.match(
    initialize,
    /if \(heldGrant && message\.grantToken === heldGrant\)/,
    'a tab holding the consumed grant must release on the message alone',
  );
});

test('every awaited call in updatePassword is inside a try', () => {
  /*
   * ResetPassword only clears its busy flag after this function settles, so any
   * rejection that escapes leaves the screen disabled on "Saving..." for good.
   * d56fc53 closed that for the mutation; a865963 then added a session read
   * OUTSIDE the try and reopened it. Both halves, or neither.
   */
  const update = body(store, /updatePassword: async[\s\S]*?\n {2}\},/, 'updatePassword');
  const awaitedAuth = update.match(/await client\.auth\.\w+\(/g) ?? [];
  assert.equal(awaitedAuth.length, 1, 'expected exactly getSession -- a new auth call needs its own guard here');
  assert.match(
    update,
    /try \{\s*live = await client\.auth\.getSession\(/,
    'getSession must be awaited inside a try, or its rejection strands the screen',
  );
  assert.match(update, /try \{\s*response = await fetch\(/, 'the password request must be awaited inside a try too');
});

test('a recovery grant is released when its session ends', () => {
  /*
   * The explicit signOut action only clears the tab that ran it. A token
   * expiring, or a sign-out in another tab, arrives here as SIGNED_OUT -- and
   * without this the grant outlived its session and was inherited by whoever
   * signed in next.
   */
  const initialize = body(store, /initialize: async[\s\S]*?\n {2}\},/, 'initialize');
  assert.match(initialize, /event === 'SIGNED_OUT'/, 'SIGNED_OUT must release the recovery grant');
  assert.match(
    initialize,
    /event === 'SIGNED_OUT' && recoveryFor[\s\S]*?recordSpentRecoveryUser\(recoveryFor/,
    'SIGNED_OUT must durably revoke the grant for tabs that miss the transient event',
  );
  /*
   * And for the account whose session ended, whether or not THIS tab holds a
   * grant. A tab opened after the recovery shares the session but has no
   * `recoveryFor`, so revoking only the local grant recorded nothing at all
   * there -- and a later ordinary sign-in let the unloaded recovery tab come
   * back to a matching session and a grant nobody had retired.
   *
   * SIGNED_OUT carries a null session, so the id has to have been kept from
   * the last session this tab saw. The behaviour itself is proved by
   * "a session ending in a tab that holds no grant still ends the recovery"
   * in tests/auth-smoke/password-reset.spec.ts; this only pins that both ids
   * are still what gets revoked.
   */
  assert.match(
    initialize,
    /if \(event === 'SIGNED_OUT'\) \{\s*if \(lastAuthUserId\) recordSpentRecoveryUser\(lastAuthUserId\);/,
    'the account signed out here must be revoked whether or not this tab holds a grant',
  );
  assert.match(
    initialize,
    /\} else if \(session\) \{\s*lastAuthUserId = session\.user\.id;/,
    'the account must be remembered from the last session seen, since SIGNED_OUT arrives empty',
  );
  /*
   * A recovery ends when the password is set, and that can happen in a
   * different tab: auth-js broadcasts the grant to every open tab, but the
   * store and sessionStorage recording it are tab-local. Clearing only where
   * updatePassword ran left other tabs holding a spent grant.
   */
  assert.match(
    initialize,
    /event === 'USER_UPDATED'/,
    'a completed update must release the grant in every tab, not only the acting one',
  );
});

test('the recovery callback navigation marker is consumed', () => {
  /*
   * A module-level boolean made the first tab that ever opened a recovery link
   * a permanent opener. A later recovery link in another tab could then yank it
   * back to reset-password even though its old callback was long gone.
   */
  assert.match(
    authCallbackArrival,
    /createRecoveryCallbackNavigationIntent/,
    'the callback marker must be represented as a consumable intent',
  );
  assert.match(
    app,
    /consumeRecoveryCallbackNavigation\(\)/,
    'the redirect must consume the current callback rather than ask a lifetime boolean',
  );
});

test('a validated recovery survives a reload', () => {
  // auth-js clears the callback fragment once it has validated the link, so a
  // refresh arrives with a good session and no recovery event. Held only in
  // memory, the grant vanished and a valid link was reported as expired.
  assert.match(store, /sessionStorage/, 'the grant must outlive a page reload');
  assert.match(store, /RECOVERY_USER_KEY/, 'the stored grant must be a user id, never a token');
});

test('the signup confirmation surface never asserts an email that may not exist', () => {
  /*
   * Supabase hides whether an address was already registered, so the two
   * no-session outcomes are indistinguishable to the customer. Copy that says
   * "Confirm your email" or "open the link to activate the account" asserts a
   * confirmation is waiting -- false for an address that already had an
   * account, and precisely the claim that stranded the owner in the first
   * place. The store message was already neutral; the panel contradicted it.
   */
  for (const claim of ['Confirm your email', 'Confirm {confirmationEmail}', 'activate the account']) {
    assert.equal(login.includes(claim), false, `the signup surface asserts a confirmation exists: ${claim}`);
  }
  // It must still cover BOTH branches rather than going silent.
  assert.match(login, /If that address is new to XBAR/, 'the new-account branch must be named');
  assert.match(login, /nothing was sent/, 'the existing-account branch must be named');
});

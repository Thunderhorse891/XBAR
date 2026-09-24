import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { XbarWordmark } from '@/components/BrandMark';
import { billingPath, billingPathForTier } from '@/lib/billingRoutes';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './cleanEntryExperience.css';
import './loginHero.css';
import { canPresentThirdPartySignIn, canPresentPurchaseFlow } from '@/lib/nativePlatform';
import { presentableOAuthProviders } from '@/lib/authProviders';
import { readBrowserStorage, removeBrowserStorage, writeBrowserStorage } from '@/lib/browserStorage';
import { markCommandCenterEntry } from '@/lib/commandCenterEntry';

type AuthMode = 'signin' | 'signup';
type BusyState = 'password' | 'google' | 'facebook' | 'apple' | 'reset' | 'code' | 'verify' | 'resend' | '';
type FormMessage = { tone: 'success' | 'error'; text: string };

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const emailId = useId();
  const passwordId = useId();
  const pushToast = useUiStore((state) => state.pushToast);
  const cloud = useCloudStore();
  const setUpWorkspace = useXbarStore((state) => state.initializeWorkspace);
  // Read through the reporting helpers: these run during RENDER, and reaching
  // for localStorage throws outright in a browser with site data blocked -- so
  // an unguarded read here replaced the sign-in screen, the first thing a
  // customer sees, with the error boundary.
  const [email, setEmail] = useState(() => readBrowserStorage('xbar-remembered-email') ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => readBrowserStorage('xbar-remember-me') === 'true');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<BusyState>('');
  const [formMessage, setFormMessage] = useState<FormMessage | null>(null);
  // Set only once a signup returns without a session, so the screen can stop
  // being a form and start being instructions about an inbox.
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const entryPanel = useRef<HTMLElement>(null);
  const entryHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!confirmationEmail) return;
    entryHeading.current?.focus({ preventScroll: true });
    entryPanel.current?.scrollIntoView({ block: 'start' });
  }, [confirmationEmail]);
  const authMode: AuthMode = params.get('mode') === 'signup' ? 'signup' : 'signin';
  const selectedPlan = params.get('plan') ?? '';
  const workspaceSetupPath = useMemo(() => {
    const setupParams = new URLSearchParams();
    if (selectedPlan) setupParams.set('plan', selectedPlan);
    const query = setupParams.toString();
    return query ? `/setup?${query}` : '/setup';
  }, [selectedPlan]);
  const redirectTarget = useMemo(() => {
    if (authMode === 'signup') return workspaceSetupPath;
    const from = (location.state as { from?: string } | null)?.from;
    if (from) return from;
    // A store build has no purchase path, so sending someone to billing the
    // moment they sign in is an arrival at a paywall they cannot act on.
    if (!canPresentPurchaseFlow()) return '/';
    return selectedPlan ? billingPathForTier(selectedPlan) : billingPath;
  }, [authMode, location.state, selectedPlan, workspaceSetupPath]);
  const supabaseReady = isSupabaseConfigured();
  // A button per provider this deployment has actually enabled in Supabase.
  // Anything else redirects into `Unsupported provider: provider is not
  // enabled`, which is a 400 the customer experiences as "the button does
  // nothing".
  const oauthProviders = useMemo(() => presentableOAuthProviders(), []);

  /*
   * Also the way OUT of the confirmation state, in both directions: clearing
   * `confirmationEmail` is what puts the form back. Re-selecting the mode
   * already in effect is therefore meaningful rather than a no-op -- it is how
   * "use a different address" returns to signup with the address still there
   * to correct.
   */
  const setMode = (mode: AuthMode) => {
    // A message about the previous mode is worse than no message: "Confirm
    // your email" left standing over a sign-in form reads as an instruction.
    setFormMessage(null);
    setConfirmationEmail('');
    /*
     * The MESSAGE goes; the hold does not.
     *
     * This is where the hold used to be released, on the reasoning that
     * somebody who had switched modes had read the explanation and moved on.
     * That conflates two things. Clearing the message is right. Clearing the
     * redirect suppression meant that a customer parked here by a rejected
     * link -- with an older session still live -- who pressed "Create account"
     * was carried into the OLD account instead: measured landing on
     * `/app/billing`, since the redirect still resolved against the previous
     * mode. Changing modes is a decision to become somebody else, not a
     * decision to resume the session that is already open.
     */
    const next = new URLSearchParams();
    if (mode === 'signup') next.set('mode', 'signup');
    if (selectedPlan) next.set('plan', selectedPlan);
    setParams(next, { replace: true });
  };

  /*
   * A callback can fail while a session is still valid -- auth-js keeps the
   * existing one when a URL login is rejected, so an expired link or a
   * cancelled consent opened while another tab is signed in arrives here with
   * `cloud.status === 'signed-in'`. The redirect below then navigated away
   * before the explanation could be read, and the failure looked like a
   * success.
   *
   * So a reported callback failure holds the screen. It is held in state
   * rather than in the URL: the query parameter is cleared as soon as it is
   * read, because leaving it there would re-announce the failure on every
   * reload.
   */
  const [callbackFailed, setCallbackFailed] = useState(false);

  useEffect(() => {
    if (callbackFailed) return;
    if (cloud.session && cloud.status === 'signed-in') navigate(redirectTarget, { replace: true });
  }, [callbackFailed, cloud.session, cloud.status, navigate, redirectTarget]);

  /*
   * A callback that failed before it could produce a session.
   *
   * Under the hash router the fragment is the route, so `#error=...` reaches
   * no screen at all without the rewrite in main.tsx; it arrives here as
   * `authError` instead. It is cleared once read, or a reload would keep
   * re-announcing a failure the customer has already dealt with.
   */
  useEffect(() => {
    const authError = params.get('authError');
    if (!authError) return;
    setCallbackFailed(true);
    setFormMessage({ tone: 'error', text: authError });
    const next = new URLSearchParams(params);
    next.delete('authError');
    setParams(next, { replace: true });
  }, [params, setParams]);

  /*
   * Every auth outcome has to land in the form, not only in a toast.
   *
   * Toasts are transient and live in a corner: a customer who mistypes a
   * password watches the button go from "Authenticating..." back to "Sign In"
   * with nothing to read, and concludes the button is broken. Reporting
   * through one function is what guarantees it -- there is no path that can
   * raise a toast and forget the panel, because the panel is not optional here.
   */
  /*
   * Whether an outcome can change who is signed in. `notice` covers everything
   * that reports back to the same screen without a session -- mail sent, a
   * code requested, a provider redirect started.
   */
  type ReportKind = 'session' | 'notice';
  const report = (title: string, result: { ok: boolean; message: string }, kind: ReportKind, showToast = true) => {
    const tone = result.ok ? 'success' : 'error';
    if (showToast) pushToast({ title, message: result.message, tone });
    setFormMessage({ tone, text: result.message });
    /*
     * Only an attempt that actually PRODUCED A SESSION ends the hold.
     *
     * This is the funnel every auth outcome passes through, which is why the
     * hold is released here rather than only where the mode changes -- that
     * left someone who simply signed in again stranded on the sign-in screen,
     * watching a success message with the redirect still suppressed.
     *
     * Releasing it on FAILURE was worse: a rejected callback can arrive while
     * an existing session is still valid -- auth-js keeps one when a URL login
     * fails -- so a customer who then typed another account's password WRONGLY
     * would have released the hold, and the redirect would have carried them
     * into the OLD account's workspace.
     *
     * `result.ok` alone was not enough either, because most of what passes
     * through here succeeds WITHOUT signing anybody in: sending reset mail,
     * requesting a code, resending a confirmation. Each returns `ok`, none of
     * them changes who is signed in, and releasing the hold on any of them
     * dropped the customer into the old account with the very message they had
     * just asked for -- "Check your inbox" -- unmounted on the way out.
     *
     * So `kind` is a required argument rather than something inferred from the
     * result: the question "can this outcome change who is signed in?" has to
     * be answered at every call site, including ones written later.
     */
    if (result.ok && kind === 'session') setCallbackFailed(false);
  };
  const rememberEmailPreference = () => {
    if (remember) {
      writeBrowserStorage('xbar-remember-me', 'true');
      writeBrowserStorage('xbar-remembered-email', email);
    } else {
      removeBrowserStorage('xbar-remember-me');
      removeBrowserStorage('xbar-remembered-email');
    }
  };

  const markLocalWorkspaceIntent = () => {
    markCommandCenterEntry();
    if (selectedPlan) writeBrowserStorage('xbar-local-plan-intent', selectedPlan);
    void trackRuntimeEvent(
      productEvent(productEventNames.localWorkspaceEntered, {
        selectedPlan: selectedPlan || undefined,
        storage: 'browser-local',
      }),
    );
  };

  const openBrowserWorkspace = () => {
    markLocalWorkspaceIntent();
    setUpWorkspace({ businessName: 'XBAR Ranch', ranchName: 'XBAR Ranch' });
    navigate(canPresentPurchaseFlow() ? (selectedPlan ? billingPathForTier(selectedPlan) : billingPath) : '/', {
      replace: true,
    });
  };

  const openWorkspaceSetup = () => {
    markLocalWorkspaceIntent();
    navigate(workspaceSetupPath);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('password');
    rememberEmailPreference();
    if (!supabaseReady) {
      // No cloud auth is configured in this build, so no credentials were
      // checked — never report a sign-in that did not happen.
      pushToast({
        title: 'Local workspace opened',
        message: 'Cloud sign-in is not configured in this build, so XBAR opened your browser-local workspace instead.',
        tone: 'info',
      });
      openBrowserWorkspace();
      setBusy('');
      return;
    }
    if (authMode === 'signin') {
      const result = await cloud.signInWithPassword(email, password);
      report(result.ok ? 'Welcome back' : 'We could not sign you in', result, 'session');
      setBusy('');
      return;
    }

    const result = await cloud.signUpWithPassword(email, password);
    // "Account created" is only true when one was, and only a session proves
    // it: the other successful outcomes are a request for a confirmation that
    // has not happened yet, so the screen switches to waiting on the inbox.
    /*
     * Only a session proves an account was created. The other two outcomes are
     * deliberately indistinguishable to the customer -- Supabase hides which
     * one happened to prevent enumeration -- so the heading must not assert
     * that a confirmation is waiting, which is false for an address that
     * already had an account and is exactly the claim that stranded one.
     */
    report(
      result.ok
        ? result.outcome === 'signed-in'
          ? 'Account created'
          : 'Check your email'
        : 'We could not create that account',
      result,
      // Only the signed-in outcome created a session; the others are an inbox.
      result.outcome === 'signed-in' ? 'session' : 'notice',
      // The dedicated confirmation screen is the announcement; a toast would cover it.
      !(result.ok && result.outcome !== 'signed-in'),
    );
    if (result.ok && result.outcome !== 'signed-in') {
      setConfirmationEmail(email.trim());
      // The confirmation panel supplies this initial message; later resend results remain visible.
      setFormMessage(null);
      // The credential does not belong on a screen that is now about an inbox.
      // It was accepted, the next step is in the customer's email, and leaving
      // it in a field means it is still sitting there behind whatever the
      // browser does with an unsubmitted form.
      setPassword('');
    }
    setBusy('');
  };
  const resendConfirmation = async () => {
    setBusy('resend');
    const result = await cloud.resendSignUpConfirmation(confirmationEmail || email);
    report(result.ok ? 'Confirmation email requested' : 'We could not send that again', result, 'notice');
    setBusy('');
  };
  const oauth = async (provider: 'google' | 'facebook' | 'apple') => {
    setBusy(provider);
    const result =
      provider === 'google'
        ? await cloud.signInWithGoogle()
        : provider === 'facebook'
          ? await cloud.signInWithFacebook()
          : await cloud.signInWithApple();
    // Success here means the provider redirect STARTED; the session, if any,
    // arrives in the document that comes back.
    report(result.ok ? `Continue with ${provider}` : `${provider} sign-in unavailable`, result, 'notice');
    setBusy('');
  };
  /*
   * The only route into a store build for an account that has no password.
   *
   * Hiding the OAuth buttons on native (they cannot complete in a WebView)
   * removed the sole credential of every account created through Google, Apple
   * or Facebook. Those accounts have no password, so the password form cannot
   * help them, and "Forgot password?" resets a password that was never set.
   *
   * A CODE rather than a magic link, and the difference is the whole fix. A
   * link signs the customer in wherever it opens, which is a browser -- the
   * app never receives the session, so the account is still locked out of iOS.
   * A code is typed in here and exchanged here, so the session lands in the
   * app. This screen previously offered the link, which read like a solution
   * and was not one.
   */
  const [emailCode, setEmailCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const requestEmailCode = async () => {
    setBusy('code');
    const result = await cloud.sendEmailCode(email);
    if (result.ok) setCodeSent(true);
    report(result.ok ? 'Sign-in code sent' : 'Sign-in code unavailable', result, 'notice');
    setBusy('');
  };
  const submitEmailCode = async () => {
    setBusy('verify');
    const result = await cloud.verifyEmailCode(email, emailCode);
    report(result.ok ? 'Welcome back' : 'That code did not work', result, 'session');
    if (result.ok) setEmailCode('');
    setBusy('');
  };
  const reset = async () => {
    setBusy('reset');
    const result = await cloud.sendPasswordReset(email);
    report(result.ok ? 'Check your inbox' : 'Reset unavailable', result, 'notice');
    setBusy('');
  };
  /*
   * Lifted out of the form so it survives the form being replaced.
   *
   * Every auth outcome has to land on the screen and not only in a toast, and
   * the confirmation state has outcomes of its own -- a resend succeeding or
   * failing. Leaving this inside the form would have meant those reported only
   * as a toast, quietly reintroducing the thing `report` exists to prevent.
   */
  const messagePanel = formMessage && (
    <p
      className={`clean-auth-message clean-auth-message--${formMessage.tone}`}
      role={formMessage.tone === 'error' ? 'alert' : 'status'}
    >
      {formMessage.text}
    </p>
  );

  const label = authMode === 'signin' ? 'System access' : selectedPlan ? `${selectedPlan} tier` : 'New workspace';
  const title = authMode === 'signin' ? 'Sign In' : 'Create Account';
  const description = selectedPlan
    ? `Create credentials, set up your workspace, then continue to the ${selectedPlan} plan.`
    : authMode === 'signin'
      ? 'Sign in to your workspace.'
      : 'Create a sign-in for your XBAR workspace.';

  return (
    <main className="clean-entry-shell clean-entry-shell--brand-auth">
      <section
        ref={entryPanel}
        className={`clean-login-layout${confirmationEmail ? ' clean-login-layout--confirmation' : ''}`}
        aria-label={authMode === 'signin' ? 'Sign in to XBAR' : 'Create an XBAR account'}
      >
        <aside className="clean-login-visual motion-brand-in" aria-label="XBAR brand">
          <img
            className="clean-login-visual__art"
            src="/brand/xbar-report-horse.png"
            width="1672"
            height="941"
            fetchPriority="high"
            alt="XBAR horse emblem"
          />
          <div className="clean-login-visual__copy">
            <h2>
              Your ranch.
              <br />
              In clear view.
            </h2>
            <p>Bring your horses, records, and next decisions together.</p>
          </div>
          <ul className="clean-login-capabilities" aria-label="Workspace tools">
            <li>Horse records</li>
            <li>Documents</li>
            <li>Sale reports</li>
          </ul>
        </aside>

        <section className="clean-auth-card clean-auth-card--login">
          <a className="clean-brand clean-brand--login" href="/" aria-label="XBAR home">
            <span>
              <XbarWordmark className="clean-brand__lockup" title="" />
              <small>Horse records</small>
            </span>
          </a>

          <div className="clean-auth-card__header">
            <p>{label}</p>
            <h1 ref={entryHeading} tabIndex={-1}>
              {confirmationEmail ? 'Check your email' : title}
            </h1>
            <span>{confirmationEmail ? 'New accounts need email confirmation.' : description}</span>
          </div>

          {/*
            A deployment whose build received no VITE_SUPABASE_URL /
            VITE_SUPABASE_ANON_KEY cannot check anybody's password, and until
            now said so only in a toast AFTER the form was submitted. Before
            that, the screen was an ordinary sign-in form: email, password, a
            Sign In button. Someone with a real account typed their real
            password into it, pressed the button, and landed in an empty
            browser-local workspace -- which reads exactly like "my login is
            broken" rather than like "this deployment has no cloud auth".

            A build-time misconfiguration is not something the customer can act
            on, but it is something they are entitled to see before they hand
            over a password. Stated up front, it also turns diagnosis into
            reading the screen instead of reading the bundle.
          */}
          {!supabaseReady && (
            <div className="clean-auth-callout" role="status">
              <h2>Cloud sign-in is not configured here</h2>
              <p>
                This build has no connection to the XBAR account service, so no password typed here can be checked and
                no existing account can be opened. Continuing starts a workspace stored only in this browser. If you
                have an XBAR account, it is not reachable from this address.
              </p>
            </div>
          )}

          {/*
            One screen, one state. Leaving the signup form standing under this
            callout meant the screen told the customer to go and open an email
            while still offering the button that produced it -- with their
            address and password still filled in. Pressing it again is the
            obvious thing to do when the email has not arrived yet, and it
            spends Supabase's signup email allowance on duplicates, which for a
            project already struggling to deliver the first one makes the actual
            problem worse. The resend control below is the same intent, done
            once and rate-limited by Supabase as a resend rather than a signup.
          */}
          {confirmationEmail ? (
            <div className="clean-auth-callout clean-confirmation" role="status">
              <div className="clean-confirmation__address">
                <span>Email address</span>
                <strong>{confirmationEmail}</strong>
                <button type="button" disabled={busy !== ''} onClick={() => setMode('signup')}>
                  Use a different address
                </button>
              </div>
              <p>
                <strong>New to XBAR?</strong> Open the confirmation link in your email to continue. Check your spam
                folder if it hasn’t arrived.
              </p>
              <div className="clean-confirmation__existing">
                <p>
                  <strong>Already have an account?</strong> No new confirmation email is sent. Sign in with your
                  existing details, or choose “Forgot password?” on the sign-in page.
                </p>
                <button
                  className="clean-primary-button"
                  type="button"
                  disabled={busy !== ''}
                  onClick={() => setMode('signin')}
                >
                  Back to sign in
                </button>
              </div>
              <div className="clean-confirmation__resend">
                <span>Still waiting for a new-account email?</span>
                <button type="button" disabled={busy !== ''} onClick={() => void resendConfirmation()}>
                  {busy === 'resend' ? 'Sending...' : 'Send it again'}
                </button>
              </div>
              {messagePanel}
            </div>
          ) : (
            <form className="clean-form" onSubmit={submit} aria-busy={busy !== ''}>
              <div className="clean-field">
                <label htmlFor={emailId}>Email or User ID</label>
                <input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (formMessage?.tone === 'error') setFormMessage(null);
                  }}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="clean-field">
                <label htmlFor={passwordId}>Password</label>
                <div className="clean-password-field">
                  <input
                    id={passwordId}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (formMessage?.tone === 'error') setFormMessage(null);
                    }}
                    autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide entered value' : 'Show entered value'}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <div className="clean-auth-options">
                <label>
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />{' '}
                  Remember me
                </label>
                {authMode === 'signin' && supabaseReady && (
                  <button type="button" disabled={!email || busy !== ''} onClick={reset}>
                    {busy === 'reset' ? 'Sending...' : 'Forgot password?'}
                  </button>
                )}
              </div>
              <button
                className="clean-primary-button"
                type="submit"
                disabled={!email || password.length < 8 || busy !== ''}
              >
                {busy === 'password' ? 'Authenticating...' : authMode === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
              {messagePanel}
              {supabaseReady && !canPresentThirdPartySignIn() && authMode === 'signin' && (
                <>
                  <div className="clean-divider">
                    <span>or</span>
                  </div>
                  <button type="button" disabled={busy !== '' || !email.trim()} onClick={() => void requestEmailCode()}>
                    {busy === 'code' ? 'Sending...' : codeSent ? 'Send another code' : 'Email me a sign-in code'}
                  </button>
                  {codeSent && (
                    <>
                      <input
                        className="field-input"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="6-digit code"
                        value={emailCode}
                        onChange={(event) => setEmailCode(event.target.value)}
                      />
                      <button
                        type="button"
                        disabled={busy !== '' || !emailCode.trim()}
                        onClick={() => void submitEmailCode()}
                      >
                        {busy === 'verify' ? 'Checking...' : 'Sign in with code'}
                      </button>
                    </>
                  )}
                  {/*
                  Reachable is not the same as findable. Someone who signed up
                  with Google arrives here, finds their button gone, and has no
                  reason to think an emailed code is the route in — so the
                  control has to say who it is for, or the app reads as broken.
                */}
                  <p className="clean-auth-hint">
                    If you first signed up with Google, Apple or Facebook, use this — those buttons cannot complete
                    sign-in inside the app.
                  </p>
                </>
              )}
              {supabaseReady && oauthProviders.length > 0 && (
                <>
                  <div className="clean-divider">
                    <span>or continue with</span>
                  </div>
                  <div className="clean-social-grid">
                    {oauthProviders.map((provider) => (
                      <button key={provider} type="button" disabled={busy !== ''} onClick={() => oauth(provider)}>
                        {provider[0].toUpperCase() + provider.slice(1)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </form>
          )}

          <div className="clean-auth-footer">
            {confirmationEmail ? null : supabaseReady ? (
              <div>
                <span>{authMode === 'signin' ? "Don't have an account?" : 'Already have an account?'}</span>
                <button type="button" onClick={() => setMode(authMode === 'signin' ? 'signup' : 'signin')}>
                  {authMode === 'signin' ? 'Create account' : 'Sign in'}
                </button>
              </div>
            ) : (
              <div>
                <span>Starting fresh?</span>
                <button type="button" onClick={openWorkspaceSetup}>
                  Create workspace
                </button>
              </div>
            )}
            {!confirmationEmail && canPresentPurchaseFlow() && <a href="/pricing">View plans</a>}
            <span>© 2026 XBAR</span>
          </div>
        </section>
      </section>
    </main>
  );
}

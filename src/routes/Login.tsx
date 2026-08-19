import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { canPresentPurchaseFlow, canPresentThirdPartySignIn, publicSiteHref } from '@/lib/nativePlatform';
import { XbarMark } from '@/components/BrandMark';
import { billingPath } from '@/lib/billingRoutes';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './cleanEntryExperience.css';

type AuthMode = 'signin' | 'signup';
type BusyState = 'password' | 'google' | 'facebook' | 'apple' | 'reset' | 'code' | 'verify' | '';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const emailId = useId();
  const passwordId = useId();
  const pushToast = useUiStore((state) => state.pushToast);
  const cloud = useCloudStore();
  const setUpWorkspace = useXbarStore((state) => state.initializeWorkspace);
  const [email, setEmail] = useState(() => localStorage.getItem('xbar-remembered-email') ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => localStorage.getItem('xbar-remember-me') === 'true');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<BusyState>('');
  // Passwordless sign-in. This is the only route into the app for an account
  // created through Google, Apple or Facebook — those have no password, and the
  // emailed link/reset flows cannot return to a capacitor:// origin.
  const [codeSent, setCodeSent] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const authMode: AuthMode = params.get('mode') === 'signup' ? 'signup' : 'signin';
  const selectedPlan = params.get('plan') ?? '';
  const redirectTarget = useMemo(() => {
    const from = (location.state as { from?: string } | null)?.from;
    if (from) return from;
    return selectedPlan ? `${billingPath}?plan=${encodeURIComponent(selectedPlan)}` : billingPath;
  }, [location.state, selectedPlan]);
  const supabaseReady = isSupabaseConfigured();

  const setMode = (mode: AuthMode) => {
    const next = new URLSearchParams();
    if (mode === 'signup') next.set('mode', 'signup');
    if (selectedPlan) next.set('plan', selectedPlan);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (cloud.session && cloud.status === 'signed-in') navigate(redirectTarget, { replace: true });
  }, [cloud.session, cloud.status, navigate, redirectTarget]);

  const toast = (title: string, result: { ok: boolean; message: string }) =>
    pushToast({ title, message: result.message, tone: result.ok ? 'success' : 'error' });
  const rememberEmailPreference = () => {
    if (remember) {
      localStorage.setItem('xbar-remember-me', 'true');
      localStorage.setItem('xbar-remembered-email', email);
    } else {
      localStorage.removeItem('xbar-remember-me');
      localStorage.removeItem('xbar-remembered-email');
    }
  };

  const markLocalWorkspaceIntent = () => {
    localStorage.setItem('xbar-command-center-entry', 'true');
    if (selectedPlan) localStorage.setItem('xbar-local-plan-intent', selectedPlan);
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
    navigate(redirectTarget, { replace: true });
  };

  const openWorkspaceSetup = () => {
    markLocalWorkspaceIntent();
    navigate('/setup');
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
    const result =
      authMode === 'signin'
        ? await cloud.signInWithPassword(email, password)
        : await cloud.signUpWithPassword(email, password);
    toast(
      result.ok ? (authMode === 'signin' ? 'Welcome back' : 'Account created') : 'We could not complete that',
      result,
    );
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
    toast(result.ok ? `Continue with ${provider}` : `${provider} sign-in unavailable`, result);
    setBusy('');
  };
  const requestEmailCode = async () => {
    setBusy('code');
    const result = await cloud.sendEmailCode(email);
    toast(result.ok ? 'Code sent' : 'Could not send a code', result);
    if (result.ok) setCodeSent(true);
    setBusy('');
  };

  const submitEmailCode = async () => {
    setBusy('verify');
    const result = await cloud.verifyEmailCode(email, emailCode);
    toast(result.ok ? 'Welcome back' : 'That code did not work', result);
    if (result.ok) setEmailCode('');
    setBusy('');
  };

  const reset = async () => {
    setBusy('reset');
    const result = await cloud.sendPasswordReset(email);
    toast(result.ok ? 'Reset email sent' : 'Reset unavailable', result);
    setBusy('');
  };
  const label = authMode === 'signin' ? 'System access' : selectedPlan ? `${selectedPlan} tier` : 'New workspace';
  const title = authMode === 'signin' ? 'Sign In' : 'Create Account';
  const description = selectedPlan
    ? `Create credentials, then continue to the ${selectedPlan} plan.`
    : authMode === 'signin'
      ? 'Sign in to your workspace.'
      : 'Create a sign-in for your XBAR workspace.';

  return (
    <main className="clean-entry-shell clean-entry-shell--brand-auth">
      <section
        className="clean-login-layout"
        aria-label={authMode === 'signin' ? 'Sign in to XBAR' : 'Create an XBAR account'}
      >
        <aside className="clean-login-visual" aria-label="XBAR brand">
          <img
            className="clean-login-visual__horse"
            src="/brand/xbar-horse-outline-safe.png"
            width="980"
            height="331"
            alt=""
          />
          <img
            className="clean-login-visual__watermark"
            src="/brand/xbar-x-watermark-main.png"
            width="512"
            height="512"
            alt=""
          />
          <div className="clean-login-visual__copy">
            <img
              className="clean-login-visual__wordmark"
              src="/brand/xbar-wordmark.png"
              width="420"
              height="120"
              alt="XBAR"
            />
            <h2>XBAR Ranch Management</h2>
            <p>Keep your horse records, documents, and sale packets organized in one place.</p>
          </div>
          <dl className="clean-login-proof" aria-label="XBAR workspace">
            <div>
              <dt>Local-first</dt>
              <dd>Start offline</dd>
            </div>
            <div>
              <dt>Cloud sync</dt>
              <dd>When configured</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>Ready when you are</dd>
            </div>
          </dl>
        </aside>

        <section className="clean-auth-card clean-auth-card--login">
          <a className="clean-brand clean-brand--login" href="/" aria-label="XBAR home">
            <span className="clean-brand__mark" aria-hidden="true">
              <XbarMark tone="mono" />
            </span>
            <span>
              <strong>XBAR</strong>
              <small>Horse records</small>
            </span>
          </a>

          <div className="clean-auth-card__header">
            <p>{label}</p>
            <h1>{title}</h1>
            <span>{description}</span>
          </div>

          <form className="clean-form" onSubmit={submit} aria-busy={busy !== ''}>
            <div className="clean-field">
              <label htmlFor={emailId}>Email or User ID</label>
              <input
                id={emailId}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
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
                  onChange={(event) => setPassword(event.target.value)}
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
            {supabaseReady && authMode === 'signin' && (
              <div className="clean-email-code">
                {codeSent ? (
                  <>
                    <label className="clean-field" htmlFor="signin-code">
                      <span>Sign-in code</span>
                      <input
                        id="signin-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="6-digit code"
                        value={emailCode}
                        onChange={(event) => setEmailCode(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="clean-secondary-button"
                      disabled={!emailCode || busy !== ''}
                      onClick={() => void submitEmailCode()}
                    >
                      {busy === 'verify' ? 'Checking...' : 'Sign in with code'}
                    </button>
                    <button
                      type="button"
                      className="clean-email-code__resend"
                      disabled={busy !== ''}
                      onClick={() => void requestEmailCode()}
                    >
                      {busy === 'code' ? 'Sending...' : 'Send a new code'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="clean-secondary-button"
                      disabled={!email || busy !== ''}
                      onClick={() => void requestEmailCode()}
                    >
                      {busy === 'code' ? 'Sending...' : 'Email me a sign-in code'}
                    </button>
                    <p className="clean-email-code__hint">
                      No password? If you first signed up with Google, Apple or Facebook, use this.
                    </p>
                  </>
                )}
              </div>
            )}
            {supabaseReady && canPresentThirdPartySignIn() && (
              <>
                <div className="clean-divider">
                  <span>or continue with</span>
                </div>
                <div className="clean-social-grid">
                  {(['google', 'facebook', 'apple'] as const).map((provider) => (
                    <button key={provider} type="button" disabled={busy !== ''} onClick={() => oauth(provider)}>
                      {provider[0].toUpperCase() + provider.slice(1)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </form>

          <div className="clean-auth-footer">
            {supabaseReady ? (
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
            {/* A store build shows no route to pricing: it is a call to action for a
                non-IAP purchase (3.1.1), and the marketing page is not in the bundle. */}
            {canPresentPurchaseFlow() ? <a href={publicSiteHref('/pricing')}>View plans</a> : null}
            <span>© 2026 XBAR</span>
          </div>
        </section>
      </section>
    </main>
  );
}

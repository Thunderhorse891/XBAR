import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './cleanEntryExperience.css';

type AuthMode = 'signin' | 'signup';
type BusyState = 'password' | 'google' | 'facebook' | 'apple' | 'reset' | '';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const emailId = useId();
  const passwordId = useId();
  const pushToast = useUiStore((state) => state.pushToast);
  const cloud = useCloudStore();
  const initializeWorkspace = useXbarStore((state) => state.initializeWorkspace);
  const [email, setEmail] = useState(() => localStorage.getItem('xbar-remembered-email') ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => localStorage.getItem('xbar-remember-me') === 'true');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<BusyState>('');
  const authMode: AuthMode = params.get('mode') === 'signup' ? 'signup' : 'signin';
  const selectedPlan = params.get('plan') ?? '';
  const redirectTarget = useMemo(() => {
    const from = (location.state as { from?: string } | null)?.from;
    if (from) return from;
    return selectedPlan ? `/subscribe?plan=${encodeURIComponent(selectedPlan)}` : '/subscribe';
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

  const toast = (title: string, result: { ok: boolean; message: string }) => pushToast({ title, message: result.message, tone: result.ok ? 'success' : 'error' });
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
    void trackRuntimeEvent(productEvent(productEventNames.localWorkspaceEntered, { selectedPlan: selectedPlan || undefined, storage: 'browser-local' }));
  };

  const openBrowserWorkspace = () => {
    markLocalWorkspaceIntent();
    initializeWorkspace({ businessName: 'XBAR Ranch', ranchName: 'XBAR Ranch' });
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
      pushToast({
        title: 'Signed in',
        message: 'Choose a plan to continue.',
        tone: 'success',
      });
      openBrowserWorkspace();
      setBusy('');
      return;
    }
    const result = authMode === 'signin' ? await cloud.signInWithPassword(email, password) : await cloud.signUpWithPassword(email, password);
    toast(result.ok ? (authMode === 'signin' ? 'Welcome back' : 'Account created') : 'We could not complete that', result);
    setBusy('');
  };
  const oauth = async (provider: 'google' | 'facebook' | 'apple') => {
    setBusy(provider);
    const result = provider === 'google' ? await cloud.signInWithGoogle() : provider === 'facebook' ? await cloud.signInWithFacebook() : await cloud.signInWithApple();
    toast(result.ok ? `Continue with ${provider}` : `${provider} sign-in unavailable`, result);
    setBusy('');
  };
  const reset = async () => {
    setBusy('reset');
    const result = await cloud.sendPasswordReset(email);
    toast(result.ok ? 'Reset email sent' : 'Reset unavailable', result);
    setBusy('');
  };
  const label = authMode === 'signin' ? 'System access' : selectedPlan ? `${selectedPlan} tier` : 'New operator';
  const title = authMode === 'signin' ? 'Sign In' : 'Create Account';
  const description = selectedPlan
    ? `Create credentials, then continue to the ${selectedPlan} plan.`
    : authMode === 'signin'
      ? 'Sign in to your workspace.'
      : 'Create a sign-in for your XBAR workspace.';

  return (
    <main className="clean-entry-shell clean-entry-shell--brand-auth">
      <section className="clean-login-layout" aria-label={authMode === 'signin' ? 'Sign in to XBAR' : 'Create an XBAR account'}>
        <aside className="clean-login-visual" aria-label="XBAR brand">
          <img className="clean-login-visual__horse" src="/brand/xbar-horse-outline-safe.png" width="980" height="331" alt="" />
          <img className="clean-login-visual__watermark" src="/brand/xbar-x-watermark-main.png" width="512" height="512" alt="" />
          <div className="clean-login-visual__copy">
            <img className="clean-login-visual__wordmark" src="/brand/xbar-wordmark.png" width="420" height="120" alt="XBAR" />
            <h2>XBAR Ranch Management</h2>
            <p>Keep your horse records, paperwork, and sale documents organized in one place.</p>
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
          <Link className="clean-brand clean-brand--login" to="/landing" aria-label="XBAR home">
            <span className="clean-brand__mark" aria-hidden="true">
              <XbarMark tone="mono" />
            </span>
            <span>
              <strong>XBAR</strong>
              <small>Horse records</small>
            </span>
          </Link>

          <div className="clean-auth-card__header">
            <p>{label}</p>
            <h1>{title}</h1>
            <span>{description}</span>
          </div>

          <form className="clean-form" onSubmit={submit} aria-busy={busy !== ''}>
            <div className="clean-field">
              <label htmlFor={emailId}>Email or User ID</label>
              <input id={emailId} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
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
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide entered value' : 'Show entered value'}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div className="clean-auth-options">
              <label>
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember me
              </label>
              {authMode === 'signin' && supabaseReady && (
                <button type="button" disabled={!email || busy !== ''} onClick={reset}>
                  {busy === 'reset' ? 'Sending...' : 'Forgot password?'}
                </button>
              )}
            </div>
            <button className="clean-primary-button" type="submit" disabled={!email || password.length < 8 || busy !== ''}>
              {busy === 'password' ? 'Authenticating...' : authMode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
            {supabaseReady && (
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
            <Link to="/landing">View plans</Link>
            <span>© 2026 XBAR</span>
          </div>
        </section>
      </section>
    </main>
  );
}

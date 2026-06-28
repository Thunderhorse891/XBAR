import { type FormEvent, useEffect, useMemo, useState } from 'react';
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

const localFacts = [
  'Try XBAR in this browser without creating a cloud account.',
  'Backups and cloud sync can be configured later.',
  'Paid billing opens through the subscription page.',
];

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
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
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('password');
    const result = authMode === 'signin' ? await cloud.signInWithPassword(email, password) : await cloud.signUpWithPassword(email, password);
    if (remember) {
      localStorage.setItem('xbar-remember-me', 'true');
      localStorage.setItem('xbar-remembered-email', email);
    } else {
      localStorage.removeItem('xbar-remember-me');
      localStorage.removeItem('xbar-remembered-email');
    }
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
  const enterWorkspace = () => {
    localStorage.setItem('xbar-command-center-entry', 'true');
    if (selectedPlan) localStorage.setItem('xbar-local-plan-intent', selectedPlan);
    initializeWorkspace({ businessName: 'XBAR Ranch', ranchName: 'XBAR Ranch' });
    void trackRuntimeEvent(productEvent(productEventNames.localWorkspaceEntered, { selectedPlan: selectedPlan || undefined, storage: 'browser-local' }));
    navigate(redirectTarget, { replace: true });
  };

  const label = !supabaseReady ? 'Browser evaluation' : authMode === 'signin' ? 'Welcome back' : selectedPlan ? `${selectedPlan} plan` : 'Create account';
  const title = !supabaseReady ? 'Start your XBAR trial.' : authMode === 'signin' ? 'Sign in to XBAR.' : 'Create your XBAR account.';
  const description = !supabaseReady
    ? 'Open a local workspace, choose a plan, and review the product without the confusing demo layer.'
    : selectedPlan
      ? `Create your account, then continue to ${selectedPlan} checkout.`
      : 'Access horse records, sale packets, ownership, care, reminders, and buyer workflows.';

  return (
    <main className="clean-entry-shell">
      <section className="clean-auth-card" aria-label={supabaseReady ? authMode === 'signin' ? 'Sign in to XBAR' : 'Create an XBAR account' : 'Start XBAR locally'}>
        <Link className="clean-brand" to="/landing" aria-label="XBAR overview">
          <span className="clean-brand__mark" aria-hidden="true">
            <XbarMark tone="mono" />
          </span>
          <span>
            <strong>XBAR</strong>
            <small>Equine operations</small>
          </span>
        </Link>

        <div className="clean-auth-card__header">
          <p>{label}</p>
          <h1>{title}</h1>
          <span>{description}</span>
        </div>

        {supabaseReady ? (
          <form className="clean-form" onSubmit={submit} aria-busy={busy !== ''}>
            <label className="clean-field">
              <span>Email</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
            </label>
            <label className="clean-field">
              <span>Password</span>
              <div className="clean-password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                  minLength={8}
                  required
                />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
            <div className="clean-auth-options">
              <label>
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember me
              </label>
              {authMode === 'signin' && (
                <button type="button" disabled={!email || busy !== ''} onClick={reset}>
                  {busy === 'reset' ? 'Sending...' : 'Forgot password?'}
                </button>
              )}
            </div>
            <button className="clean-primary-button" type="submit" disabled={!email || password.length < 8 || busy !== ''}>
              {busy === 'password' ? 'Working...' : authMode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
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
          </form>
        ) : (
          <div className="clean-local-start">
            <ul>
              {localFacts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            <button className="clean-primary-button" type="button" onClick={enterWorkspace}>
              Start free trial
            </button>
            <p>Local browser storage is for evaluation. Export backups before using it as your only record source.</p>
          </div>
        )}

        <div className="clean-auth-footer">
          {supabaseReady ? (
            <div>
              <span>{authMode === 'signin' ? "Don't have an account?" : 'Already have an account?'}</span>
              <button type="button" onClick={() => setMode(authMode === 'signin' ? 'signup' : 'signin')}>
                {authMode === 'signin' ? 'Create account' : 'Sign in'}
              </button>
            </div>
          ) : null}
          <Link to="/landing">Back to overview</Link>
        </div>
      </section>
    </main>
  );
}

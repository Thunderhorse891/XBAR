import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './authExperience.css';
import './localEvaluation.css';

type AuthMode = 'signin' | 'signup';
type BusyState = 'password' | 'google' | 'facebook' | 'apple' | 'reset' | '';
const features = ['Horse records', 'Health & compliance', 'Documents', 'Expenses', 'Ownership'];

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

  const label = !supabaseReady ? 'Local evaluation workspace' : authMode === 'signin' ? 'Welcome back' : selectedPlan ? `${selectedPlan} workspace` : 'Start your operation';
  const title = !supabaseReady ? 'Evaluate XBAR' : authMode === 'signin' ? 'Sign in to your account' : 'Create your XBAR account';
  const description = !supabaseReady ? 'Explore the complete operating workflow in this browser before cloud account services are enabled.' : selectedPlan ? `Create your workspace, then review ${selectedPlan} in secure checkout.` : 'Your ranch, horses, records, and next actions in one place.';

  return <main className="xbar-login-shell lp-shell"><div className="xbar-login-noise" aria-hidden="true" /><div className="lp-frame"><section className="lp-brand" aria-labelledby="login-brand-title"><div className="brand-canvas" aria-hidden="true"><div className="brand-canvas__lockup"><span className="brand-canvas__mark"><XbarMark tone="mono" /></span><span className="brand-canvas__bar">XBAR</span><span className="brand-canvas__rule" /></div></div><div className="lp-tagline"><strong id="login-brand-title">Horse Management.</strong><span>Reimagined.</span></div><div className="lp-features">{features.map((feature) => <div className="lp-feature" key={feature}>{feature}</div>)}</div><p className="lp-card-sub">Built for ranches, breeders, and serious horse owners.</p></section>
    <section className="lp-auth" aria-label={supabaseReady ? authMode === 'signin' ? 'Sign in to XBAR' : 'Create an XBAR account' : 'Evaluate XBAR locally'}><div className="lp-card"><p className="lp-card-label">{label}</p><h1 className="lp-card-title">{title}</h1><p className="lp-card-sub">{description}</p>
      {supabaseReady ? <form className="lp-form" onSubmit={submit} aria-busy={busy !== ''}><label className="lp-label"><span className="lp-label-text">Email</span><input className="lp-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label className="lp-label"><span className="lp-label-text">Password</span><div className="lp-input-wrap"><input className="lp-input" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required /><button className="lp-pw-eye" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></div></label><div className="lp-options"><label className="lp-remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember me</label>{authMode === 'signin' && <button className="lp-forgot" type="button" disabled={!email || busy !== ''} onClick={reset}>{busy === 'reset' ? 'Sending...' : 'Forgot password?'}</button>}</div><button className="lp-btn-primary" type="submit" disabled={!email || password.length < 8 || busy !== ''}>{busy === 'password' ? 'Working...' : authMode === 'signin' ? 'Sign in' : 'Create account'}</button><div className="lp-divider"><span>or</span></div>{(['google', 'facebook', 'apple'] as const).map((provider) => <button key={provider} className="lp-btn-social" type="button" disabled={busy !== ''} onClick={() => oauth(provider)}>Continue with {provider[0].toUpperCase() + provider.slice(1)}</button>)}</form> : <div className="lp-local-mode"><div className="lp-local-mode__heading"><strong>Use XBAR in this browser</strong><span>This is a real working evaluation, not a cloud account.</span></div><ul className="lp-local-mode__facts"><li>Your workspace is stored on this device.</li><li>Backup and restore controls remain available inside Settings.</li><li>Cloud sync, multi-device access, and managed checkout require account services.</li></ul><button className="lp-btn-enter" type="button" onClick={enterWorkspace}>Enter local evaluation</button><span className="lp-local-mode__notice">Do not treat browser-local storage as the only copy of essential ranch records. Export backups while evaluating.</span></div>}
      <div className="lp-auth-footer">{supabaseReady && <div className="lp-mode-switch"><span>{authMode === 'signin' ? "Don't have an account?" : 'Already have an account?'}</span><button type="button" onClick={() => setMode(authMode === 'signin' ? 'signup' : 'signin')}>{authMode === 'signin' ? 'Create one' : 'Sign in'}</button></div>}<Link className="public-action public-action--quiet" to="/landing">Back to XBAR overview</Link></div></div></section></div></main>;
}

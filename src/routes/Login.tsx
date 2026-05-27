import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { isCloudAuthRequired, isLocalModeEnabled, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import './authExperience.css';

type AuthMode = 'signin' | 'signup';
type BusyState = 'password' | 'magic' | 'facebook' | 'reset' | '';

const featureProof = [
  { label: 'Horse Management', icon: 'horse' },
  { label: 'Health & Compliance', icon: 'shield' },
  { label: 'Documents & Records', icon: 'document' },
  { label: 'Expenses & Reports', icon: 'dollar' },
  { label: 'Ownership & Transfers', icon: 'people' },
] as const;

function FeatureIcon({ icon }: { icon: (typeof featureProof)[number]['icon'] }) {
  const paths = {
    horse: 'M4 17c1.2-5 4.8-8.5 9.7-9.6 2-.4 4.2.5 5.3 2.4.8 1.3 1 3.3.3 5.1l-1.2 3.1m-9.4-2.6h5.4M7.5 18h10.2M9.2 9.2 7.5 6.7m5.8 1.1 1.5-2.6',
    shield: 'M12 3.4 19 6v5.4c0 4.3-2.6 7.5-7 9.2-4.4-1.7-7-4.9-7-9.2V6l7-2.6Zm-3.1 8.4 2 2 4.4-4.8',
    document: 'M7 3.8h7.1L18 7.7v12.5H7V3.8Zm7 0v4h4M9.8 12h4.6M9.8 15.5h5.8',
    dollar: 'M12 4v16m4-11.8c-.8-1-2.2-1.6-4-1.6-2.2 0-3.7 1-3.7 2.5 0 1.7 1.8 2.3 3.8 2.8 2.1.5 3.9 1.1 3.9 2.9 0 1.6-1.7 2.8-4 2.8-1.8 0-3.5-.6-4.5-1.8',
    people: 'M8.8 18.7c.2-2.5 1.8-4.1 3.7-4.1s3.5 1.6 3.7 4.1M12.5 12.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM4 18.5c.2-2 1.5-3.4 3.1-3.8M20 18.5c-.2-2-1.5-3.4-3.1-3.8',
  };

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={paths[icon]} stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useUiStore((state) => state.pushToast);
  const status = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);
  const sendMagicLink = useCloudStore((state) => state.sendMagicLink);
  const signInWithPassword = useCloudStore((state) => state.signInWithPassword);
  const signUpWithPassword = useCloudStore((state) => state.signUpWithPassword);
  const sendPasswordReset = useCloudStore((state) => state.sendPasswordReset);
  const signInWithFacebook = useCloudStore((state) => state.signInWithFacebook);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [busy, setBusy] = useState<BusyState>('');
  const redirectTarget = useMemo(() => {
    const next = (location.state as { from?: string } | null)?.from;
    return next || '/';
  }, [location.state]);
  const cloudRequired = isCloudAuthRequired();
  const allowLocalMode = isLocalModeEnabled();
  const supabaseReady = isSupabaseConfigured();
  const passwordActionLabel = authMode === 'signin' ? 'Sign in' : 'Create account';

  useEffect(() => {
    if (session && status === 'signed-in') {
      navigate(redirectTarget, { replace: true });
    }
  }, [navigate, redirectTarget, session, status]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const shell = shellRef.current;
    if (!shell) return;
    const bounds = shell.getBoundingClientRect();
    shell.style.setProperty('--spotlight-x', `${event.clientX - bounds.left}px`);
    shell.style.setProperty('--spotlight-y', `${event.clientY - bounds.top}px`);
  }, []);

  const handlePasswordAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('password');
    const result = authMode === 'signin' ? await signInWithPassword(email, password) : await signUpWithPassword(email, password);
    pushToast({
      title: result.ok ? (authMode === 'signin' ? 'Signed in' : 'Account created') : authMode === 'signin' ? 'Sign-in blocked' : 'Signup blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setBusy('');
  };

  const handleMagicLink = async () => {
    setBusy('magic');
    const result = await sendMagicLink(email);
    pushToast({ title: result.ok ? 'Secure link sent' : 'Secure link blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    setBusy('');
  };

  const handlePasswordReset = async () => {
    setBusy('reset');
    const result = await sendPasswordReset(email);
    pushToast({ title: result.ok ? 'Reset email sent' : 'Reset blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    setBusy('');
  };

  const handleFacebook = async () => {
    setBusy('facebook');
    const result = await signInWithFacebook();
    pushToast({ title: result.ok ? 'Facebook sign-in started' : 'Facebook sign-in failed', message: result.message, tone: result.ok ? 'success' : 'error' });
    setBusy('');
  };

  return (
    <main ref={shellRef} className="xbar-login-shell xbar-login-shell--command" onPointerMove={handlePointerMove}>
      <div className="xbar-login-noise" aria-hidden="true" />
      <div className="xbar-login-command-frame">
        <section className="xbar-login-brand-panel" aria-labelledby="xbar-login-headline">
          <div className="xbar-login-brand-stage" aria-hidden="true">
            <div className="xbar-login-horse-emblem">
              <XbarMark title="XBAR logo" className="h-full w-full" />
            </div>
            <div className="xbar-login-chrome-wordmark">XBAR</div>
            <p id="xbar-login-headline" className="xbar-login-reference-line">
              <strong>The operating system</strong>
              <span>for modern horse operations</span>
            </p>
          </div>

          <div className="xbar-login-feature-row" aria-label="XBAR product coverage">
            {featureProof.map((item) => (
              <div key={item.label} className="xbar-login-feature-tile">
                <FeatureIcon icon={item.icon} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          <div className="xbar-login-built-for">
            <FeatureIcon icon="shield" />
            <span>Built for ranches, breeders, and serious horse owners.</span>
          </div>
        </section>

        <section className="xbar-login-auth-panel" aria-label="Workspace access">
          <div className="xbar-login-card">
            <div className="xbar-login-card-copy">
              <span className="xbar-login-welcome">Welcome Back</span>
              <h2>{authMode === 'signin' ? 'Sign in to your account' : 'Create your XBAR account'}</h2>
              <p>Access your ranch. Your horses. Your records.</p>
            </div>

            {supabaseReady ? (
              <form className="xbar-login-form" onSubmit={handlePasswordAuth}>
                <label className="xbar-login-field">
                  <span>Email</span>
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" />
                </label>
                <label className="xbar-login-field">
                  <span>Password</span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} />
                </label>

                <div className="xbar-login-options-row">
                  <label className="xbar-login-remember">
                    <input type="checkbox" />
                    <span>Remember me</span>
                  </label>
                  {authMode === 'signin' ? (
                    <button type="button" onClick={handlePasswordReset} disabled={busy !== '' || !email.trim()}>
                      {busy === 'reset' ? 'Sending...' : 'Forgot password?'}
                    </button>
                  ) : null}
                </div>

                <button className="xbar-login-primary" type="submit" disabled={busy !== '' || !email.trim() || !password}>
                  {busy === 'password' ? 'Checking access...' : passwordActionLabel}
                </button>

                <div className="xbar-login-divider"><span>OR</span></div>

                <button className="xbar-login-facebook" type="button" onClick={handleMagicLink} disabled={busy !== '' || !email.trim()}>
                  {busy === 'magic' ? 'Sending secure link...' : 'Email secure link'}
                </button>
                <button className="xbar-login-facebook" type="button" onClick={handleFacebook} disabled={busy !== ''}>
                  {busy === 'facebook' ? 'Connecting...' : 'Continue with Facebook'}
                </button>

                <div className="xbar-login-mode-switch">
                  <span>{authMode === 'signin' ? "Don't have an account?" : 'Already have an account?'}</span>
                  <button type="button" onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}>
                    {authMode === 'signin' ? 'Create one' : 'Sign in'}
                  </button>
                </div>
              </form>
            ) : !allowLocalMode ? (
              <div className="xbar-login-auth-note xbar-login-auth-note--blocked">
                Cloud auth is required for this build. Add Supabase URL and anon key before opening the workspace.
              </div>
            ) : (
              <div className="xbar-login-local-mode">
                <div className="xbar-login-auth-note">Browser preview is enabled. You can review the workspace locally before cloud auth is connected.</div>
                <button className="xbar-login-primary" type="button" onClick={() => navigate('/setup', { replace: true })}>
                  Open browser workspace
                </button>
                <button className="xbar-login-facebook" type="button" onClick={() => navigate('/setup', { replace: true })}>
                  Preview onboarding
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

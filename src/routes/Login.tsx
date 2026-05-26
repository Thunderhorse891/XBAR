import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { isCloudAuthRequired, isLocalModeEnabled, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import './authExperience.css';

type AuthMode = 'signin' | 'signup';
type BusyState = 'password' | 'magic' | 'facebook' | 'reset' | '';

const loginBrandAssetSrc = `${import.meta.env.BASE_URL}brand/xbar-app-icon.svg`;

const featureProof = [
  'Horse profiles',
  'Health and Coggins tracking',
  'Breeding and sale records',
  'Expenses and documents',
  'Built for ranches, breeders, and serious horse owners',
];

const operatingProof = [
  { label: 'Care', value: 'Coggins due dates, vaccines, vet files' },
  { label: 'Records', value: 'Registration, ownership, photos, documents' },
  { label: 'Sales', value: 'Buyer rooms, sale files, transfer packets' },
];

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
  const accessLabel = supabaseReady ? 'Cloud workspace' : cloudRequired ? 'Cloud required' : allowLocalMode ? 'Browser preview' : 'Cloud required';
  const passwordActionLabel = authMode === 'signin' ? 'Sign in' : 'Create account';

  useEffect(() => {
    if (session && status === 'signed-in') {
      navigate(redirectTarget, { replace: true });
    }
  }, [navigate, redirectTarget, session, status]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const bounds = shell.getBoundingClientRect();
    shell.style.setProperty('--spotlight-x', `${event.clientX - bounds.left}px`);
    shell.style.setProperty('--spotlight-y', `${event.clientY - bounds.top}px`);
  }, []);

  const handlePasswordAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('password');
    const result =
      authMode === 'signin'
        ? await signInWithPassword(email, password)
        : await signUpWithPassword(email, password);
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
    pushToast({
      title: result.ok ? 'Secure link sent' : 'Secure link blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setBusy('');
  };

  const handlePasswordReset = async () => {
    setBusy('reset');
    const result = await sendPasswordReset(email);
    pushToast({
      title: result.ok ? 'Reset email sent' : 'Reset blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setBusy('');
  };

  const handleFacebook = async () => {
    setBusy('facebook');
    const result = await signInWithFacebook();
    pushToast({
      title: result.ok ? 'Facebook sign-in started' : 'Facebook sign-in failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setBusy('');
  };

  return (
    <main ref={shellRef} className="xbar-login-shell" onPointerMove={handlePointerMove}>
      <div className="xbar-login-noise" aria-hidden="true" />
      <div className="xbar-login-grid">
        <section className="xbar-login-brand-panel" aria-labelledby="xbar-login-headline">
          <div className="xbar-login-brand-top">
            <div className="xbar-login-mark">
              <XbarMark title="XBAR logo" className="h-full w-full" />
            </div>
            <div>
              <div className="xbar-login-wordmark">XBAR</div>
              <div className="xbar-login-system-label">Ranch operations software</div>
            </div>
          </div>

          <div className="xbar-login-value">
            <h1 id="xbar-login-headline">The operating system for modern horse operations.</h1>
            <p>
              Horse records, Coggins, vaccines, expenses, breeding notes, sale files, and ranch documents organized in one clean system.
            </p>
          </div>

          <div className="xbar-login-feature-list" aria-label="XBAR product coverage">
            {featureProof.map((item) => (
              <div key={item} className="xbar-login-feature-item">
                <span aria-hidden="true" />
                <strong>{item}</strong>
              </div>
            ))}
          </div>

          <div className="xbar-login-media-card">
            <div className="xbar-login-brand-preview" aria-hidden="true">
              <img src={loginBrandAssetSrc} alt="" />
            </div>
            <div className="xbar-login-video-copy">
              <span>Built for the paper trail</span>
              <strong>Every record. Every horse. One place.</strong>
            </div>
          </div>
        </section>

        <section className="xbar-login-auth-panel" aria-label="Workspace access">
          <div className="xbar-login-mobile-brand">
            <div className="xbar-login-mark xbar-login-mark--small">
              <XbarMark title="XBAR logo" className="h-full w-full" />
            </div>
            <div>
              <div className="xbar-login-wordmark">XBAR</div>
              <div className="xbar-login-system-label">Ranch operations software</div>
            </div>
          </div>

          <div className="xbar-login-card">
            <div className="xbar-login-card-top">
              <span>{accessLabel}</span>
              <small>Private workspace</small>
            </div>

            <div className="xbar-login-card-copy">
              <h2>{authMode === 'signin' ? 'Sign in to XBAR.' : 'Create your XBAR account.'}</h2>
              <p>
                Less chaos. Better operations. Your ranch records stay organized behind your workspace access.
              </p>
            </div>

            <div className="xbar-login-tabs" role="tablist" aria-label="Authentication mode">
              <button type="button" role="tab" aria-selected={authMode === 'signin'} data-active={authMode === 'signin'} onClick={() => setAuthMode('signin')}>
                Sign in
              </button>
              <button type="button" role="tab" aria-selected={authMode === 'signup'} data-active={authMode === 'signup'} onClick={() => setAuthMode('signup')}>
                Sign up
              </button>
            </div>

            {supabaseReady ? (
              <form className="xbar-login-form" onSubmit={handlePasswordAuth}>
                <label className="xbar-login-field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="owner@xbar.com"
                    autoComplete="email"
                  />
                </label>
                <label className="xbar-login-field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={authMode === 'signin' ? 'Enter your password' : 'Use at least 8 characters'}
                    autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                  />
                </label>

                <button className="xbar-login-primary" type="submit" disabled={busy !== '' || !email.trim() || !password}>
                  {busy === 'password' ? 'Checking access...' : passwordActionLabel}
                </button>

                <div className="xbar-login-secondary-row">
                  <button type="button" onClick={handleMagicLink} disabled={busy !== '' || !email.trim()}>
                    {busy === 'magic' ? 'Sending...' : 'Email secure link'}
                  </button>
                  {authMode === 'signin' ? (
                    <button type="button" onClick={handlePasswordReset} disabled={busy !== '' || !email.trim()}>
                      {busy === 'reset' ? 'Sending...' : 'Forgot password'}
                    </button>
                  ) : null}
                </div>

                <button className="xbar-login-facebook" type="button" onClick={handleFacebook} disabled={busy !== ''}>
                  {busy === 'facebook' ? 'Connecting...' : 'Continue with Facebook'}
                </button>
              </form>
            ) : !allowLocalMode ? (
              <div className="xbar-login-auth-note xbar-login-auth-note--blocked">
                Cloud auth is required for this build. Add Supabase URL and anon key before opening the workspace.
              </div>
            ) : (
              <div className="xbar-login-local-mode">
                <div className="xbar-login-auth-note">
                  Browser preview is enabled. You can review the workspace locally before cloud auth is connected.
                </div>
                <button className="xbar-login-primary" type="button" onClick={() => navigate('/setup', { replace: true })}>
                  Open browser workspace
                </button>
                <button className="xbar-login-facebook" type="button" onClick={() => navigate('/setup', { replace: true })}>
                  Preview onboarding
                </button>
              </div>
            )}

            <div className="xbar-login-proof-grid" aria-label="Workspace proof points">
              {operatingProof.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

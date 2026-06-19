import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { isFacebookSharingConfigured, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './authExperience.css';

type AuthMode = 'signin' | 'signup';
type BusyState = 'password' | 'magic' | 'facebook' | 'google' | 'apple' | 'reset' | '';

/* ─── icon components ─── */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M19.6 10.227c0-.709-.064-1.39-.182-2.045H10v3.868h5.382a4.6 4.6 0 01-1.996 3.018v2.51h3.232c1.891-1.742 2.982-4.305 2.982-7.35z" fill="#4285F4" />
      <path d="M10 20c2.7 0 4.964-.895 6.618-2.423l-3.232-2.509c-.895.6-2.04.955-3.386.955-2.605 0-4.81-1.759-5.595-4.123H1.064v2.59A9.996 9.996 0 0010 20z" fill="#34A853" />
      <path d="M4.405 11.9A6.01 6.01 0 014.09 10c0-.663.114-1.305.314-1.9V5.51H1.064A9.996 9.996 0 000 10c0 1.614.386 3.14 1.064 4.49L4.405 11.9z" fill="#FBBC05" />
      <path d="M10 3.977c1.468 0 2.786.505 3.823 1.496l2.868-2.868C14.959.99 12.695 0 10 0A9.996 9.996 0 001.064 5.51l3.34 2.59C5.192 5.736 7.396 3.977 10 3.977z" fill="#EA4335" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M14.52 0c.077.975-.283 1.942-.847 2.663-.565.737-1.46 1.303-2.37 1.236-.096-.916.32-1.874.848-2.502C12.72.686 13.669.12 14.52 0zM17.84 13.3c-.404.916-.598 1.325-1.12 2.133-.727 1.107-1.751 2.487-3.02 2.5-.978.012-1.302-.637-2.712-.628-1.41.008-1.76.644-2.74.632-1.27-.013-2.243-1.258-2.97-2.365-2.032-3.097-2.246-6.73-.993-8.667.893-1.38 2.302-2.188 3.631-2.188 1.35 0 2.2.64 3.32.64 1.087 0 1.75-.643 3.318-.643 1.188 0 2.45.648 3.34 1.769-2.934 1.61-2.459 5.81.946 6.817z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.4 19 6v5.4c0 4.3-2.6 7.5-7 9.2-4.4-1.7-7-4.9-7-9.2V6l7-2.6Zm-3.1 8.4 2 2 4.4-4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─── feature tile data ─── */
const featureProof = [
  {
    label: 'Horse\nRecords',
    path: 'M4 17c1.2-5 4.8-8.5 9.7-9.6 2-.4 4.2.5 5.3 2.4.8 1.3 1 3.3.3 5.1l-1.2 3.1m-9.4-2.6h5.4M7.5 18h10.2M9.2 9.2 7.5 6.7m5.8 1.1 1.5-2.6',
  },
  {
    label: 'Health &\nCompliance',
    path: 'M12 3.4 19 6v5.4c0 4.3-2.6 7.5-7 9.2-4.4-1.7-7-4.9-7-9.2V6l7-2.6Zm-3.1 8.4 2 2 4.4-4.8',
  },
  {
    label: 'Documents',
    path: 'M7 3.8h7.1L18 7.7v12.5H7V3.8Zm7 0v4h4M9.8 12h4.6M9.8 15.5h5.8',
  },
  {
    label: 'Expenses',
    path: 'M12 4v16m4-11.8c-.8-1-2.2-1.6-4-1.6-2.2 0-3.7 1-3.7 2.5 0 1.7 1.8 2.3 3.8 2.8 2.1.5 3.9 1.1 3.9 2.9 0 1.6-1.7 2.8-4 2.8-1.8 0-3.5-.6-4.5-1.8',
  },
  {
    label: 'Ownership',
    path: 'M8.8 18.7c.2-2.5 1.8-4.1 3.7-4.1s3.5 1.6 3.7 4.1M12.5 12.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM4 18.5c.2-2 1.5-3.4 3.1-3.8M20 18.5c-.2-2-1.5-3.4-3.1-3.8',
  },
] as const;


export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useUiStore((state) => state.pushToast);
  const status = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);
  const signInWithPassword = useCloudStore((state) => state.signInWithPassword);
  const signUpWithPassword = useCloudStore((state) => state.signUpWithPassword);
  const sendPasswordReset = useCloudStore((state) => state.sendPasswordReset);
  const signInWithGoogle = useCloudStore((state) => state.signInWithGoogle);
  const signInWithApple = useCloudStore((state) => state.signInWithApple);
  const signInWithFacebook = useCloudStore((state) => state.signInWithFacebook);
  const initializeWorkspace = useXbarStore((state) => state.initializeWorkspace);
  const activateWorkspaceInvitation = useXbarStore((state) => state.activateWorkspaceInvitation);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('xbar-remember-me') === 'true');
  const inviteId = useMemo(() => new URLSearchParams(location.search).get('invite'), [location.search]);
  const [email, setEmail] = useState(() => (localStorage.getItem('xbar-remember-me') === 'true' ? localStorage.getItem('xbar-remembered-email') ?? '' : ''));
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [busy, setBusy] = useState<BusyState>('');
  const [showPassword, setShowPassword] = useState(false);
  const redirectTarget = useMemo(() => (location.state as { from?: string } | null)?.from || '/', [location.state]);
  const supabaseReady = isSupabaseConfigured();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('mode') === 'signup') {
      setAuthMode('signup');
    }
  }, [location.search]);

  useEffect(() => {
    if (session && status === 'signed-in') {
      if (inviteId) {
        activateWorkspaceInvitation(inviteId);
      }
      navigate(redirectTarget, { replace: true });
    }
  }, [navigate, redirectTarget, session, status, inviteId, activateWorkspaceInvitation]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const shell = shellRef.current;
    if (!shell) return;
    const bounds = shell.getBoundingClientRect();
    shell.style.setProperty('--spotlight-x', `${event.clientX - bounds.left}px`);
    shell.style.setProperty('--spotlight-y', `${event.clientY - bounds.top}px`);
  }, []);

  const enterXbar = () => {
    window.localStorage.setItem('xbar-command-center-entry', 'true');
    initializeWorkspace({ businessName: 'XBAR Ranch', ranchName: 'XBAR Ranch' });
    navigate('/', { replace: true });
  };

  const handlePasswordAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('password');
    const result = authMode === 'signin'
      ? await signInWithPassword(email, password)
      : await signUpWithPassword(email, password);
    if (rememberMe) {
      localStorage.setItem('xbar-remember-me', 'true');
      localStorage.setItem('xbar-remembered-email', email);
    } else {
      localStorage.removeItem('xbar-remember-me');
      localStorage.removeItem('xbar-remembered-email');
    }
    pushToast({
      title: result.ok ? (authMode === 'signin' ? 'Signed in' : 'Account created') : (authMode === 'signin' ? 'Sign-in blocked' : 'Signup blocked'),
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setBusy('');
  };

  const handlePasswordReset = async () => {
    setBusy('reset');
    const result = await sendPasswordReset(email);
    pushToast({ title: result.ok ? 'Reset email sent' : 'Reset blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    setBusy('');
  };

  const handleGoogle = async () => {
    setBusy('google');
    const result = await signInWithGoogle();
    pushToast({ title: result.ok ? 'Google sign-in started' : 'Google sign-in failed', message: result.message, tone: result.ok ? 'success' : 'error' });
    setBusy('');
  };

  const handleFacebook = async () => {
    setBusy('facebook');
    const result = await signInWithFacebook();
    pushToast({ title: result.ok ? 'Facebook sign-in started' : 'Facebook sign-in failed', message: result.message, tone: result.ok ? 'success' : 'error' });
    setBusy('');
  };

  const handleApple = async () => {
    setBusy('apple');
    const result = await signInWithApple();
    pushToast({ title: result.ok ? 'Apple sign-in started' : 'Apple sign-in failed', message: result.message, tone: result.ok ? 'success' : 'error' });
    setBusy('');
  };

  return (
    <main ref={shellRef} className="xbar-login-shell lp-shell" onPointerMove={handlePointerMove}>
      <div className="xbar-login-noise" aria-hidden="true" />

      <div className="lp-frame">

        {/* ── Left: brand panel ── */}
        <section className="lp-brand" aria-labelledby="lp-headline">
          <img
            src="/xbar-logo-sleek.png"
            alt="XBAR — Horse Management Reimagined"
            className="lp-hero-logo"
          />

          <div className="lp-tagline">
            <strong id="lp-headline">Horse Management.</strong>
            <span>Reimagined.</span>
          </div>

          <div className="lp-features" aria-label="XBAR product coverage">
            {featureProof.map((item) => (
              <div key={item.label} className="lp-feature">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d={item.path} stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          <div className="lp-trust">
            <ShieldIcon />
            <span>Built for ranches. Breeders.<br />And serious horse owners.</span>
          </div>
        </section>

        {/* ── Right: auth panel ── */}
        <section className="lp-auth" aria-label="Sign in to XBAR">
          <div className="lp-card">

            {/* Invite banner */}
            {inviteId && (
              <div className="lp-invite-banner">
                You were invited to join a workspace. Sign in or create an account to accept.
              </div>
            )}

            {/* Card header */}
            <p className="lp-card-label">{inviteId ? 'Workspace invite' : authMode === 'signup' ? 'Create your account' : 'Welcome Back'}</p>
            <h1 className="lp-card-title">
              {inviteId ? 'Accept your invitation' : authMode === 'signin' ? 'Sign in to your account' : 'Create your XBAR account'}
            </h1>
            <p className="lp-card-sub">Access your ranch. Your horses. Your records.</p>

            {supabaseReady ? (
              <form className="lp-form" onSubmit={handlePasswordAuth}>

                {/* Email */}
                <label className="lp-label">
                  <span className="lp-label-text">Email</span>
                  <div className="lp-input-wrap">
                    <input
                      className="lp-input"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                    <span className="lp-input-icon"><MailIcon /></span>
                  </div>
                </label>

                {/* Password */}
                <label className="lp-label">
                  <span className="lp-label-text">Password</span>
                  <div className="lp-input-wrap">
                    <input
                      className="lp-input"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••"
                      autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                    />
                    <span className="lp-input-icon">
                      <button
                        type="button"
                        className="lp-pw-eye"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </span>
                  </div>
                </label>

                {/* Password strength — signup only */}
                {authMode === 'signup' && password.length > 0 && (() => {
                  const len = password.length;
                  const complex = /[A-Z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
                  const level = len >= 12 && complex ? 'strong' : len >= 8 ? 'fair' : 'weak';
                  const colors: Record<string, string> = { weak: 'var(--rose)', fair: 'var(--amber)', strong: 'var(--emerald)' };
                  const widths: Record<string, string> = { weak: '33%', fair: '66%', strong: '100%' };
                  return (
                    <div className="lp-password-strength">
                      <div className="lp-password-strength__track">
                        <div className="lp-password-strength__bar" style={{ width: widths[level], background: colors[level] }} />
                      </div>
                      <span className="lp-password-strength__label" style={{ color: colors[level] }}>{level} password</span>
                      {level !== 'strong' && (
                        <span className="lp-password-strength__hint">Strong: 12+ characters, uppercase, number &amp; symbol</span>
                      )}
                    </div>
                  );
                })()}

                {/* Options row */}
                <div className="lp-options">
                  <label className="lp-remember">
                    <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                    <span>Remember me</span>
                  </label>
                  {authMode === 'signin' && (
                    <button
                      type="button"
                      className="lp-forgot"
                      onClick={handlePasswordReset}
                      disabled={busy !== '' || !email.trim()}
                    >
                      {busy === 'reset' ? 'Sending…' : 'Forgot password?'}
                    </button>
                  )}
                </div>

                {/* Sign in button */}
                <button
                  className="lp-btn-primary"
                  type="submit"
                  disabled={busy !== '' || !email.trim() || !password.trim()}
                >
                  {busy === 'password' ? 'Checking access…' : authMode === 'signin' ? 'Sign In' : 'Create Account'}
                </button>

                {/* OAuth */}
                <div className="lp-divider"><span>OR</span></div>

                <button className="lp-btn-social" type="button" onClick={handleGoogle} disabled={busy !== ''}>
                  <GoogleIcon />
                  {busy === 'google' ? 'Connecting…' : 'Continue with Google'}
                </button>

                <button
                  className="lp-btn-social"
                  type="button"
                  onClick={handleFacebook}
                  disabled={busy !== '' || !isFacebookSharingConfigured()}
                  title={!isFacebookSharingConfigured() ? 'Facebook sign-in is not configured' : undefined}
                >
                  <FacebookIcon />
                  {busy === 'facebook' ? 'Connecting…' : 'Continue with Facebook'}
                </button>
                <button className="lp-btn-social" type="button" onClick={handleApple} disabled={busy !== ''}>
                  <AppleIcon />
                  {busy === 'apple' ? 'Connecting…' : 'Continue with Apple'}
                </button>

                {/* Mode switch */}
                <div className="lp-mode-switch">
                  <span>{authMode === 'signin' ? "Don't have an account?" : 'Already have an account?'}</span>
                  <button type="button" onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}>
                    {authMode === 'signin' ? 'Create one' : 'Sign in'}
                  </button>
                </div>

              </form>
            ) : (
              <button className="lp-btn-enter" type="button" onClick={enterXbar}>
                Enter workspace
              </button>
            )}

          </div>
        </section>

      </div>
      <footer className="lp-footer">
        <span>© {new Date().getFullYear()} XBAR LLC™</span>
        <span>·</span>
        <Link to="/terms">Terms</Link>
        <span>·</span>
        <Link to="/privacy">Privacy</Link>
      </footer>
    </main>
  );
}

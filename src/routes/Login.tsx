import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './authExperience.css';

type AuthMode = 'signin' | 'signup';
type BusyState = 'password' | 'magic' | 'facebook' | 'google' | 'apple' | 'reset' | '';

/* ─── icon components ─── */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M19.6 10.227c0-.709-.064-1.39-.182-2.045H10v3.868h5.382a4.6 4.6 0 01-1.996 3.018v2.51h3.232c1.891-1.742 2.982-4.305 2.982-7.35z" fill="#4285F4" />
      <path d="M10 20c2.7 0 4.964-.895 6.618-2.423l-3.232-2.509c-.895.6-2.04.955-3.386.955-2.605 0-4.81-1.759-5.595-4.123H1.064v2.59A9.996 9.996 0 0010 20z" fill="#34A853" />
      <path d="M4.405 11.9A6.01 6.01 0 014.09 10c0-.663.114-1.305.314-1.9V5.51H1.064A9.996 9.996 0 000 10c0 1.614.386 3.14 1.064 4.49L4.405 11.9z" fill="#FBBC05" />
      <path d="M10 3.977c1.468 0 2.786.505 3.823 1.496l2.868-2.868C14.959.99 12.695 0 10 0A9.996 9.996 0 001.064 5.51l3.34 2.59C5.192 5.736 7.396 3.977 10 3.977z" fill="#EA4335" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
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

/* ─── scoped styles ─── */
const styles = `
/* Shell — one directional light source, no competing radials */
.lp-shell{min-height:100vh;display:flex;align-items:stretch;padding:clamp(10px,1.1vw,16px);background:radial-gradient(ellipse 58% 40% at 12% 8%,rgba(12,62,148,.16) 0,transparent 42%),#020406}

/* Container frame */
.lp-frame{flex:1;display:grid;grid-template-columns:1.32fr 1fr;border-radius:11px;overflow:hidden;border:1px solid rgba(255,255,255,.082);background:#03050a;box-shadow:0 28px 70px rgba(0,0,0,.68)}

/* Brand panel — atmospheric but never competing */
.lp-brand{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(16px,2.4vw,28px);padding:clamp(28px,3.8vw,52px) clamp(22px,3vw,44px);background:linear-gradient(158deg,#060c17 0%,#02040a 100%);border-right:1px solid rgba(255,255,255,.06);text-align:center;overflow:hidden}
.lp-brand::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 70% 55% at 50% 42%,rgba(18,82,192,.1) 0,transparent 52%);pointer-events:none}

/* Logo */
.lp-hero-logo{width:clamp(170px,22vw,310px);height:auto;display:block;position:relative;z-index:1;mix-blend-mode:screen;filter:drop-shadow(0 0 14px rgba(16,74,185,.38));pointer-events:none}

/* Tagline */
.lp-tagline{display:flex;flex-direction:column;gap:4px;position:relative;z-index:1}
.lp-tagline strong{display:block;color:#4a96ff;font-size:clamp(9px,.95vw,11.5px);font-weight:700;letter-spacing:.28em;text-transform:uppercase;line-height:1}
.lp-tagline span{display:block;color:rgba(175,200,228,.55);font-size:clamp(8px,.85vw,10.5px);font-weight:600;letter-spacing:.2em;text-transform:uppercase;line-height:1}

/* Feature grid — secondary, operational */
.lp-features{display:grid;grid-template-columns:repeat(5,1fr);width:100%;max-width:510px;position:relative;z-index:1;border:1px solid rgba(255,255,255,.055);border-radius:6px;overflow:hidden}
.lp-feature{display:flex;flex-direction:column;align-items:center;gap:6px;padding:11px 5px 10px;border-right:1px solid rgba(255,255,255,.05);color:rgba(148,180,216,.5);font-size:7.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-align:center;line-height:1.4;white-space:pre-line}
.lp-feature:last-child{border-right:0}
.lp-feature svg{width:17px;height:17px;opacity:.55}

/* Trust — understated */
.lp-trust{display:flex;align-items:center;gap:10px;color:rgba(155,182,214,.5);font-size:clamp(8.5px,.8vw,10px);font-weight:700;letter-spacing:.14em;text-transform:uppercase;line-height:1.6;max-width:380px;position:relative;z-index:1}
.lp-trust svg{flex-shrink:0;width:18px;height:18px;color:rgba(60,130,240,.58)}

/* Auth panel */
.lp-auth{display:flex;align-items:center;justify-content:center;padding:clamp(20px,2.6vw,44px) clamp(16px,2.4vw,40px);background:rgba(1,3,8,.45)}

/* Auth card — the focal point */
.lp-card{position:relative;width:min(100%,404px);padding:clamp(24px,2.8vw,38px) clamp(20px,2.4vw,30px);border:1px solid rgba(255,255,255,.11);border-radius:9px;background:#07101e;box-shadow:0 18px 44px rgba(0,0,0,.46)}
.lp-card::before{content:'';position:absolute;top:-1px;left:38%;right:38%;height:1px;background:linear-gradient(90deg,transparent,rgba(46,120,245,.36),transparent)}

/* Card header */
.lp-card-label{color:#4a96ff;font-size:10px;font-weight:700;letter-spacing:.32em;text-transform:uppercase;margin-bottom:8px}
.lp-card-title{font-size:clamp(16px,1.72vw,19px);font-weight:700;color:#e8f2ff;line-height:1.15;letter-spacing:-.02em;margin-bottom:5px}
.lp-card-sub{font-size:12px;color:rgba(138,170,208,.5);line-height:1.5}

/* Form */
.lp-form{display:flex;flex-direction:column;gap:11px;margin-top:18px}
.lp-label{display:flex;flex-direction:column;gap:5px}
.lp-label-text{font-size:9.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(162,192,225,.55)}
.lp-input-wrap{position:relative;display:flex;align-items:center}
.lp-input{width:100%;min-height:42px;padding:0 38px 0 12px;border:1px solid rgba(255,255,255,.092);border-radius:6px;background:rgba(255,255,255,.038);color:#ddeeff;font-size:14px;outline:none;transition:border-color .13s,box-shadow .13s}
.lp-input::placeholder{color:rgba(82,112,148,.36)}
.lp-input:focus{border-color:rgba(46,118,248,.46);box-shadow:0 0 0 3px rgba(32,105,245,.09)}
.lp-input-icon{position:absolute;right:11px;top:50%;transform:translateY(-50%);color:rgba(92,128,168,.35);display:flex;align-items:center;pointer-events:none}
.lp-pw-eye{pointer-events:all;cursor:pointer;background:none;color:rgba(92,128,168,.35);transition:color .13s}
.lp-pw-eye:hover{color:rgba(145,190,245,.78)}

/* Options row */
.lp-options{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11.5px;color:rgba(122,152,188,.65)}
.lp-remember{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
.lp-remember input[type=checkbox]{width:13px;height:13px;accent-color:#2d8cff;cursor:pointer}
.lp-forgot{background:none;color:#4090ff;font-size:11.5px;font-weight:500;cursor:pointer;transition:color .13s}
.lp-forgot:hover{color:#6aadff}
.lp-forgot:disabled{opacity:.3;cursor:default}

/* Primary CTA — solid, confident */
.lp-btn-primary{width:100%;min-height:44px;background:#1461e8;border:1px solid rgba(26,105,250,.5);border-radius:6px;color:#fff;font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;transition:background .14s,transform .1s;box-shadow:0 6px 18px rgba(14,74,200,.34)}
.lp-btn-primary:hover:not(:disabled){background:#1e70f5;transform:translateY(-1px)}
.lp-btn-primary:active:not(:disabled){transform:translateY(0)}
.lp-btn-primary:disabled{opacity:.36;cursor:default}

/* OR divider */
.lp-divider{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;color:rgba(78,104,140,.52);font-size:10px;letter-spacing:.13em;text-transform:uppercase}
.lp-divider::before,.lp-divider::after{content:'';height:1px;background:rgba(255,255,255,.068)}

/* Social buttons */
.lp-btn-social{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:42px;border:1px solid rgba(255,255,255,.085);border-radius:6px;background:rgba(255,255,255,.026);color:rgba(172,200,232,.72);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:background .13s,border-color .13s}
.lp-btn-social:hover:not(:disabled){background:rgba(255,255,255,.048);border-color:rgba(255,255,255,.14)}
.lp-btn-social:disabled{opacity:.36;cursor:default}

/* Mode switch */
.lp-mode-switch{display:flex;align-items:center;justify-content:center;gap:6px;font-size:11.5px;color:rgba(122,152,188,.58)}
.lp-mode-switch button{background:none;color:#4090ff;font-weight:600;cursor:pointer;transition:color .13s}
.lp-mode-switch button:hover{color:#6aadff}

/* Local (no-cloud) fallback — no notes, just the action */
.lp-btn-enter{width:100%;min-height:44px;background:#1461e8;border:1px solid rgba(26,105,250,.5);border-radius:6px;color:#fff;font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;transition:background .14s,transform .1s;box-shadow:0 6px 18px rgba(14,74,200,.34);margin-top:18px}
.lp-btn-enter:hover{background:#1e70f5;transform:translateY(-1px)}

/* Responsive — on narrow screens brand collapses, card fills */
@media(max-width:1100px){.lp-frame{grid-template-columns:1fr}.lp-brand{display:none}.lp-auth{padding:clamp(22px,5vw,52px);justify-content:center;align-items:flex-start;padding-top:clamp(40px,8vh,88px)}.lp-card{width:min(100%,440px)}}
@media(max-width:480px){.lp-shell{padding:0}.lp-frame{border-radius:0;min-height:100vh;border:none}.lp-auth{padding:32px 18px}.lp-options{flex-direction:column;align-items:flex-start;gap:8px}.lp-mode-switch{flex-direction:column;gap:4px}}
`;

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
  const initializeWorkspace = useXbarStore((state) => state.initializeWorkspace);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [busy, setBusy] = useState<BusyState>('');
  const [showPassword, setShowPassword] = useState(false);
  const redirectTarget = useMemo(() => (location.state as { from?: string } | null)?.from || '/', [location.state]);
  const supabaseReady = isSupabaseConfigured();

  useEffect(() => {
    if (session && status === 'signed-in') navigate(redirectTarget, { replace: true });
  }, [navigate, redirectTarget, session, status]);

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

  const handleApple = async () => {
    setBusy('apple');
    const result = await signInWithApple();
    pushToast({ title: result.ok ? 'Apple sign-in started' : 'Apple sign-in failed', message: result.message, tone: result.ok ? 'success' : 'error' });
    setBusy('');
  };

  return (
    <main ref={shellRef} className="xbar-login-shell lp-shell" onPointerMove={handlePointerMove}>
      <style>{styles}</style>
      <div className="xbar-login-noise" aria-hidden="true" />

      <div className="lp-frame">

        {/* ── Left: brand panel ── */}
        <section className="lp-brand" aria-labelledby="lp-headline">
          <img
            src="/xbar-logo.png"
            alt="XBAR — Horse Management Reimagined"
            className="lp-hero-logo"
          />

          <div className="lp-tagline">
            <strong id="lp-headline">The operating system</strong>
            <span>for modern horse operations</span>
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

            {/* Card header */}
            <p className="lp-card-label">Welcome Back</p>
            <h1 className="lp-card-title">
              {authMode === 'signin' ? 'Sign in to your account' : 'Create your XBAR account'}
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

                {/* Options row */}
                <div className="lp-options">
                  <label className="lp-remember">
                    <input type="checkbox" />
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
                  disabled={busy !== '' || !email.trim() || !password}
                >
                  {busy === 'password' ? 'Checking access…' : authMode === 'signin' ? 'Sign In' : 'Create Account'}
                </button>

                {/* OAuth */}
                <div className="lp-divider"><span>OR</span></div>

                <button className="lp-btn-social" type="button" onClick={handleGoogle} disabled={busy !== ''}>
                  <GoogleIcon />
                  {busy === 'google' ? 'Connecting…' : 'Continue with Google'}
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
    </main>
  );
}

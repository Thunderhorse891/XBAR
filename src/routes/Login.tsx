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
    label: 'Horse\nManagement',
    path: 'M4 17c1.2-5 4.8-8.5 9.7-9.6 2-.4 4.2.5 5.3 2.4.8 1.3 1 3.3.3 5.1l-1.2 3.1m-9.4-2.6h5.4M7.5 18h10.2M9.2 9.2 7.5 6.7m5.8 1.1 1.5-2.6',
  },
  {
    label: 'Health &\nCompliance',
    path: 'M12 3.4 19 6v5.4c0 4.3-2.6 7.5-7 9.2-4.4-1.7-7-4.9-7-9.2V6l7-2.6Zm-3.1 8.4 2 2 4.4-4.8',
  },
  {
    label: 'Documents\n& Records',
    path: 'M7 3.8h7.1L18 7.7v12.5H7V3.8Zm7 0v4h4M9.8 12h4.6M9.8 15.5h5.8',
  },
  {
    label: 'Expenses\n& Reports',
    path: 'M12 4v16m4-11.8c-.8-1-2.2-1.6-4-1.6-2.2 0-3.7 1-3.7 2.5 0 1.7 1.8 2.3 3.8 2.8 2.1.5 3.9 1.1 3.9 2.9 0 1.6-1.7 2.8-4 2.8-1.8 0-3.5-.6-4.5-1.8',
  },
  {
    label: 'Ownership\n& Transfers',
    path: 'M8.8 18.7c.2-2.5 1.8-4.1 3.7-4.1s3.5 1.6 3.7 4.1M12.5 12.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM4 18.5c.2-2 1.5-3.4 3.1-3.8M20 18.5c-.2-2-1.5-3.4-3.1-3.8',
  },
] as const;

/* ─── scoped styles ─── */
const styles = `
.lp-shell{min-height:100vh;display:flex;align-items:stretch;padding:clamp(12px,1.4vw,22px);background:radial-gradient(circle at 20% 16%,rgba(18,96,218,.34) 0,transparent 24rem),radial-gradient(circle at 80% 80%,rgba(8,20,48,.7) 0,transparent 20rem),linear-gradient(140deg,#020508 0%,#050d1a 50%,#030407 100%)}
.lp-frame{flex:1;position:relative;display:grid;grid-template-columns:1.42fr 1fr;border:1px solid rgba(118,158,206,.22);border-radius:16px;overflow:hidden;background:rgba(3,6,11,.97);box-shadow:0 24px 80px rgba(0,0,0,.82),inset 0 1px 0 rgba(255,255,255,.04)}
.lp-brand{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(22px,3vw,44px);padding:clamp(32px,4.5vw,68px) clamp(24px,3.5vw,56px);background:linear-gradient(155deg,rgba(10,20,38,.96) 0%,rgba(4,8,14,.98) 100%);border-right:1px solid rgba(100,142,194,.14);text-align:center}
.lp-hero-logo{width:clamp(260px,32vw,500px);height:auto;display:block;margin:0 auto;filter:drop-shadow(0 0 38px rgba(36,126,255,.62)) drop-shadow(0 22px 56px rgba(0,0,0,.88));pointer-events:none}
.lp-tagline{display:flex;flex-direction:column;gap:6px}
.lp-tagline strong{display:block;color:#2d8cff;font-size:clamp(12px,1.3vw,17px);font-weight:800;letter-spacing:.3em;text-transform:uppercase;text-shadow:0 0 14px rgba(45,140,255,.45);line-height:1}
.lp-tagline span{display:block;color:rgba(215,232,255,.88);font-size:clamp(11px,1.1vw,14px);font-weight:700;letter-spacing:.22em;text-transform:uppercase;line-height:1}
.lp-features{display:grid;grid-template-columns:repeat(5,1fr);width:100%;max-width:660px}
.lp-feature{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 8px;border-right:1px solid rgba(168,200,236,.13);color:rgba(192,215,244,.78);font-size:9.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;text-align:center;line-height:1.3;white-space:pre-line}
.lp-feature:last-child{border-right:0}
.lp-feature svg{width:30px;height:30px;opacity:.86}
.lp-trust{display:flex;align-items:center;gap:14px;padding:15px 22px;border:1px solid rgba(96,144,202,.26);border-radius:10px;background:rgba(5,11,20,.76);color:rgba(204,224,252,.88);font-size:clamp(11px,1vw,13.5px);font-weight:800;letter-spacing:.16em;text-transform:uppercase;line-height:1.55;max-width:490px;box-shadow:0 0 22px rgba(32,100,195,.12),inset 0 1px 0 rgba(255,255,255,.05)}
.lp-trust svg{flex-shrink:0;width:30px;height:30px;color:rgba(185,212,248,.8)}
.lp-auth{display:flex;align-items:center;justify-content:flex-start;padding:clamp(22px,3vw,52px) clamp(20px,3vw,48px) clamp(22px,3vw,52px) clamp(16px,2.5vw,40px)}
.lp-card{position:relative;width:min(100%,468px);padding:clamp(26px,3.2vw,48px) clamp(22px,2.8vw,40px);border:1px solid rgba(128,170,220,.38);border-radius:14px;background:radial-gradient(circle at 50% 0%,rgba(32,100,255,.16) 0,transparent 9rem),linear-gradient(148deg,rgba(12,22,40,.95) 0%,rgba(3,7,13,.9) 100%);box-shadow:0 26px 72px rgba(0,0,0,.64),inset 0 1px 0 rgba(255,255,255,.07);backdrop-filter:blur(18px)}
.lp-card::before{content:"";position:absolute;top:-1px;left:50%;transform:translateX(-50%);width:96px;height:1px;background:linear-gradient(90deg,transparent,#4da2ff,transparent);box-shadow:0 0 14px #2d8cff}
.lp-card-label{color:#2d8cff;font-size:11.5px;font-weight:800;letter-spacing:.34em;text-transform:uppercase;margin-bottom:12px}
.lp-card-title{font-size:clamp(20px,2.2vw,27px);font-weight:700;color:#f0f7ff;line-height:1.1;letter-spacing:-.025em;margin-bottom:9px}
.lp-card-sub{font-size:13.5px;color:rgba(175,198,228,.7);line-height:1.5}
.lp-form{display:flex;flex-direction:column;gap:15px;margin-top:26px}
.lp-label{display:flex;flex-direction:column;gap:7px}
.lp-label-text{font-size:10.5px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:rgba(196,216,240,.78)}
.lp-input-wrap{position:relative;display:flex;align-items:center}
.lp-input{width:100%;min-height:50px;padding:0 44px 0 15px;border:1px solid rgba(112,152,198,.28);border-radius:8px;background:rgba(2,5,11,.65);color:#edf4ff;font-size:14.5px;outline:none;transition:border-color .15s,box-shadow .15s}
.lp-input::placeholder{color:rgba(108,138,176,.48)}
.lp-input:focus{border-color:rgba(45,140,255,.55);box-shadow:0 0 0 3px rgba(45,140,255,.11)}
.lp-input-icon{position:absolute;right:14px;top:50%;transform:translateY(-50%);color:rgba(118,152,196,.48);display:flex;align-items:center;pointer-events:none}
.lp-pw-eye{pointer-events:all;cursor:pointer;transition:color .15s;background:none}
.lp-pw-eye:hover{color:rgba(175,210,252,.9)}
.lp-options{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:rgba(148,174,210,.8)}
.lp-remember{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
.lp-remember input[type=checkbox]{width:15px;height:15px;accent-color:#2d8cff;cursor:pointer}
.lp-forgot{background:none;color:#3696ff;font-size:13px;font-weight:500;cursor:pointer;transition:color .15s}
.lp-forgot:hover{color:#72b8ff}
.lp-forgot:disabled{opacity:.4;cursor:default}
.lp-btn-primary{width:100%;min-height:52px;background:#1b6ffe;border:1px solid rgba(72,152,255,.48);border-radius:8px;color:#fff;font-size:12.5px;font-weight:800;letter-spacing:.17em;text-transform:uppercase;cursor:pointer;transition:background .18s,box-shadow .18s,transform .18s;box-shadow:0 10px 26px rgba(18,86,215,.4),inset 0 1px 0 rgba(255,255,255,.18)}
.lp-btn-primary:hover:not(:disabled){background:#2d7fff;transform:translateY(-1px);box-shadow:0 14px 34px rgba(18,86,215,.52),inset 0 1px 0 rgba(255,255,255,.22)}
.lp-btn-primary:active:not(:disabled){transform:translateY(0)}
.lp-btn-primary:disabled{opacity:.45;cursor:default}
.lp-divider{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center;color:rgba(94,122,162,.7);font-size:11px;letter-spacing:.14em}
.lp-divider::before,.lp-divider::after{content:"";height:1px;background:rgba(118,152,196,.14)}
.lp-btn-social{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:50px;border:1px solid rgba(100,140,186,.24);border-radius:8px;background:rgba(6,14,26,.72);color:rgba(196,218,246,.88);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:background .17s,border-color .17s}
.lp-btn-social:hover:not(:disabled){background:rgba(14,26,46,.82);border-color:rgba(130,170,218,.38)}
.lp-btn-social:disabled{opacity:.45;cursor:default}
.lp-mode-switch{display:flex;align-items:center;justify-content:center;gap:7px;font-size:13px;color:rgba(148,174,210,.7)}
.lp-mode-switch button{background:none;color:#3696ff;font-weight:600;cursor:pointer;transition:color .15s}
.lp-mode-switch button:hover{color:#72b8ff}
.lp-local-note{margin-top:4px;padding:15px;border:1px solid rgba(140,172,212,.2);border-radius:9px;background:rgba(6,12,22,.56);color:rgba(185,208,236,.72);font-size:13.5px;line-height:1.6}
.lp-btn-enter{width:100%;min-height:52px;margin-top:14px;background:#1b6ffe;border:1px solid rgba(72,152,255,.48);border-radius:8px;color:#fff;font-size:12.5px;font-weight:800;letter-spacing:.17em;text-transform:uppercase;cursor:pointer;transition:background .18s,box-shadow .18s,transform .18s;box-shadow:0 10px 26px rgba(18,86,215,.4),inset 0 1px 0 rgba(255,255,255,.18)}
.lp-btn-enter:hover{background:#2d7fff;transform:translateY(-1px);box-shadow:0 14px 34px rgba(18,86,215,.52),inset 0 1px 0 rgba(255,255,255,.22)}
@media(max-width:1100px){.lp-frame{grid-template-columns:1fr}.lp-auth{padding:0 clamp(20px,5vw,52px) clamp(28px,5vw,52px);justify-content:center}.lp-card{margin:0 auto;width:min(100%,500px)}}
@media(max-width:720px){.lp-shell{padding:0}.lp-frame{border-radius:0;min-height:100vh}.lp-brand{padding:28px 16px 18px}.lp-hero-logo{width:clamp(190px,74vw,320px)}.lp-features{grid-template-columns:repeat(2,1fr)}.lp-feature{border-right:0;border-bottom:1px solid rgba(168,200,236,.11)}.lp-trust{font-size:11px;padding:11px 15px;letter-spacing:.12em}.lp-auth{padding:0 16px 24px}.lp-options{align-items:flex-start;flex-direction:column;gap:10px}.lp-mode-switch{flex-direction:column}}
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
              <div style={{ marginTop: '24px' }}>
                <p className="lp-local-note">
                  This deployment is not connected to cloud sign-in. You can still explore the full command center.
                </p>
                <button className="lp-btn-enter" type="button" onClick={enterXbar}>
                  Open browser workspace
                </button>
              </div>
            )}

          </div>
        </section>

      </div>
    </main>
  );
}

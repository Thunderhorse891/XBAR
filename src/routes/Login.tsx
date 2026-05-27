import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isLocalModeEnabled, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M19.6 10.227c0-.709-.064-1.39-.182-2.045H10v3.868h5.382a4.6 4.6 0 01-1.996 3.018v2.51h3.232c1.891-1.742 2.982-4.305 2.982-7.35z" fill="#4285F4" />
      <path d="M10 20c2.7 0 4.964-.895 6.618-2.423l-3.232-2.509c-.895.6-2.04.955-3.386.955-2.605 0-4.81-1.759-5.595-4.123H1.064v2.59A9.996 9.996 0 0010 20z" fill="#34A853" />
      <path d="M4.405 11.9A6.01 6.01 0 014.09 10c0-.663.114-1.305.314-1.9V5.51H1.064A9.996 9.996 0 000 10c0 1.614.386 3.14 1.064 4.49L4.405 11.9z" fill="#FBBC05" />
      <path d="M10 3.977c1.468 0 2.786.505 3.823 1.496l2.868-2.868C14.959.99 12.695 0 10 0A9.996 9.996 0 001.064 5.51l3.34 2.59C5.192 5.736 7.396 3.977 10 3.977z" fill="#EA4335" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M14.52 0c.077.975-.283 1.942-.847 2.663-.565.737-1.46 1.303-2.37 1.236-.096-.916.32-1.874.848-2.502C12.72.686 13.669.12 14.52 0zM17.84 13.3c-.404.916-.598 1.325-1.12 2.133-.727 1.107-1.751 2.487-3.02 2.5-.978.012-1.302-.637-2.712-.628-1.41.008-1.76.644-2.74.632-1.27-.013-2.243-1.258-2.97-2.365-2.032-3.097-2.246-6.73-.993-8.667.893-1.38 2.302-2.188 3.631-2.188 1.35 0 2.2.64 3.32.64 1.087 0 1.75-.643 3.318-.643 1.188 0 2.45.648 3.34 1.769-2.934 1.61-2.459 5.81.946 6.817z" />
    </svg>
  );
}

function EyeIcon({ off }: { off?: boolean }) {
  return off ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const features = [
  {
    label: 'Horse\nManagement',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3" />
        <path d="M6 20v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
      </svg>
    ),
  },
  {
    label: 'Health &\nCompliance',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2c0 7.3-8 11.8-8 11.8z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: 'Documents &\nRecords',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    label: 'Expenses &\nReports',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    ),
  },
  {
    label: 'Ownership &\nTransfers',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
];

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useUiStore((state) => state.pushToast);
  const status = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);
  const signInWithPassword = useCloudStore((state) => state.signInWithPassword);
  const sendMagicLink = useCloudStore((state) => state.sendMagicLink);
  const resetPassword = useCloudStore((state) => state.resetPassword);
  const signInWithGoogle = useCloudStore((state) => state.signInWithGoogle);
  const signInWithApple = useCloudStore((state) => state.signInWithApple);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [busy, setBusy] = useState<'signin' | 'google' | 'apple' | 'forgot' | ''>('');

  const redirectTarget = (() => {
    const next = (location.state as { from?: string } | null)?.from;
    return next || '/';
  })();

  const allowLocalMode = isLocalModeEnabled();

  useEffect(() => {
    if (session && status === 'signed-in') {
      navigate(redirectTarget, { replace: true });
    }
  }, [navigate, redirectTarget, session, status]);

  const handleSignIn = async () => {
    if (!email.trim()) {
      pushToast({ title: 'Email required', message: 'Enter your email address.', tone: 'error' });
      return;
    }
    setBusy('signin');
    if (password) {
      const result = await signInWithPassword(email, password);
      pushToast({
        title: result.ok ? 'Signed in' : 'Sign-in failed',
        message: result.message,
        tone: result.ok ? 'success' : 'error',
      });
    } else {
      const result = await sendMagicLink(email);
      pushToast({
        title: result.ok ? 'Magic link sent' : 'Sign-in blocked',
        message: result.message,
        tone: result.ok ? 'success' : 'error',
      });
    }
    setBusy('');
  };

  const handleForgotPassword = async () => {
    setBusy('forgot');
    const result = await resetPassword(email);
    pushToast({
      title: result.ok ? 'Reset email sent' : 'Reset failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setBusy('');
  };

  const handleGoogle = async () => {
    setBusy('google');
    const result = await signInWithGoogle();
    if (!result.ok) {
      pushToast({ title: 'Google sign-in failed', message: result.message, tone: 'error' });
      setBusy('');
    }
  };

  const handleApple = async () => {
    setBusy('apple');
    const result = await signInWithApple();
    if (!result.ok) {
      pushToast({ title: 'Apple sign-in failed', message: result.message, tone: 'error' });
      setBusy('');
    }
  };

  return (
    <div className="flex min-h-screen bg-[#080c15]">

      {/* ── Left hero panel ── */}
      <div
        className="relative hidden w-[58%] flex-col justify-between overflow-hidden lg:flex"
        style={{ background: 'linear-gradient(145deg,#060b18 0%,#0d1630 45%,#08111e 75%,#050810 100%)' }}
      >
        {/* Atmospheric glows */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute right-[-8%] top-[-8%] h-[560px] w-[560px] rounded-full bg-[#0e3ecc] opacity-[0.13] blur-[130px]" />
          <div className="absolute bottom-[-5%] left-[-5%] h-[380px] w-[380px] rounded-full bg-[#082280] opacity-[0.10] blur-[110px]" />
          <div className="absolute left-[25%] top-[35%] h-[280px] w-[280px] rounded-full bg-[#0d4acc] opacity-[0.07] blur-[90px]" />
        </div>

        {/* Top logo */}
        <div className="relative z-10 flex items-center gap-4 p-12 pb-0">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#1a3570]/50 bg-[#0b1530] p-2 shadow-[0_0_0_1px_rgba(26,80,200,0.18),0_10px_28px_rgba(0,0,0,0.5)]">
            <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR" className="h-full w-full object-contain" />
          </div>
          <div>
            <div
              className="text-2xl font-black uppercase tracking-[0.2em] text-white"
              style={{ textShadow: '0 0 36px rgba(70,130,255,0.45)' }}
            >
              XBAR
            </div>
            <div className="text-[9px] font-bold uppercase tracking-[0.34em] text-[#28508a]">
              The operating system
            </div>
          </div>
        </div>

        {/* Center brand */}
        <div className="relative z-10 flex flex-col items-start px-12">
          <div className="mb-6 flex items-center justify-center opacity-[0.35]" style={{ height: '180px', width: '100%' }}>
            <img
              src={`${import.meta.env.BASE_URL}xbar-logo.png`}
              alt=""
              aria-hidden="true"
              className="h-full w-auto object-contain"
              style={{ filter: 'drop-shadow(0 0 48px rgba(70,130,255,0.7))' }}
            />
          </div>
          <div className="text-[9px] font-bold uppercase tracking-[0.34em] text-[#1555cc]">
            The operating system
          </div>
          <h1
            className="mt-3 text-[clamp(1.8rem,2.8vw,3.2rem)] font-black uppercase leading-[1.05] tracking-[0.05em] text-white"
            style={{ textShadow: '0 2px 36px rgba(20,70,180,0.55)' }}
          >
            For Modern<br />Horse Operations
          </h1>
        </div>

        {/* Bottom features + badge */}
        <div className="relative z-10 px-12 pb-10">
          <div className="mb-7 h-px bg-[linear-gradient(90deg,rgba(26,70,200,0.35),transparent)]" />

          <div className="flex items-start justify-between gap-3">
            {features.map(({ label, icon }) => (
              <div key={label} className="flex flex-col items-center gap-2 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#162e5a]/60 bg-[#0b1830]/90 text-[#3a78cc]">
                  {icon}
                </div>
                <span className="whitespace-pre-line text-[8.5px] font-semibold uppercase leading-[1.35] tracking-[0.12em] text-[#334e70]">
                  {label}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3 rounded-xl border border-[#162e5a]/50 bg-[#0b1830]/60 px-4 py-3 backdrop-blur-sm">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#163870]/50 bg-[#091428] text-[#3a78cc]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2c0 7.3-8 11.8-8 11.8z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7a9abd]">
              Built for ranches. Breeders. And serious horse owners.
            </p>
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex flex-1 items-center justify-center bg-[#080c15] px-6 py-12">

        {/* Mobile logo */}
        <div className="absolute left-5 top-5 flex items-center gap-3 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#1a2e46] bg-[#0c1428] p-1.5">
            <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR" className="h-full w-full object-contain" />
          </div>
          <span className="text-sm font-black uppercase tracking-[0.16em] text-white">XBAR</span>
        </div>

        <div className="w-full max-w-[440px]">
          <div className="rounded-2xl border border-[#182040]/90 bg-[#0e1525] px-8 py-9 shadow-[0_28px_72px_rgba(0,0,0,0.65)]">

            {isSupabaseConfigured() ? (
              <>
                <div className="mb-7">
                  <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.28em] text-[#1a6ddd]">Welcome back</div>
                  <h2 className="text-[1.8rem] font-black leading-tight tracking-[-0.03em] text-white">
                    Sign in to your account
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#4a6880]">
                    Access your ranch. Your horses. Your records.
                  </p>
                </div>

                <div className="space-y-4">
                  {/* Email */}
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.2em] text-[#50708a]" htmlFor="login-email">
                      Email
                    </label>
                    <div className="relative">
                      <input
                        id="login-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void handleSignIn()}
                        placeholder="you@example.com"
                        autoFocus
                        autoComplete="email"
                        className="w-full rounded-xl border border-[#1c2e48]/90 bg-[#090e1c] px-4 py-3 pr-11 text-sm text-white placeholder-[#2a3e54] outline-none transition-colors focus:border-[#1a5ddd] focus:ring-1 focus:ring-[#1a5ddd]/25"
                      />
                      <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#2a3e54]">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                          <polyline points="22,6 12,13 2,6" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.2em] text-[#50708a]" htmlFor="login-password">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void handleSignIn()}
                        placeholder="••••••••••"
                        autoComplete="current-password"
                        className="w-full rounded-xl border border-[#1c2e48]/90 bg-[#090e1c] px-4 py-3 pr-11 text-sm text-white placeholder-[#2a3e54] outline-none transition-colors focus:border-[#1a5ddd] focus:ring-1 focus:ring-[#1a5ddd]/25"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#2a3e54] transition-colors hover:text-[#4a6880]"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        <EyeIcon off={showPassword} />
                      </button>
                    </div>
                  </div>

                  {/* Remember + Forgot */}
                  <div className="flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-[#4a6880]">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="h-4 w-4 rounded border-[#1c2e48] bg-[#090e1c] accent-[#1a5ddd]"
                      />
                      Remember me
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleForgotPassword()}
                      disabled={busy === 'forgot'}
                      className="text-sm font-semibold text-[#1a6ddd] transition-colors hover:text-[#4090ff] disabled:opacity-50"
                    >
                      {busy === 'forgot' ? 'Sending…' : 'Forgot password?'}
                    </button>
                  </div>

                  {/* Sign in */}
                  <button
                    type="button"
                    onClick={() => void handleSignIn()}
                    disabled={busy !== '' || !email.trim()}
                    className="w-full rounded-xl bg-[#1a5ddd] py-3.5 text-sm font-black uppercase tracking-[0.18em] text-white shadow-[0_4px_20px_rgba(26,93,221,0.38)] transition-all hover:bg-[#1e6aff] hover:shadow-[0_4px_28px_rgba(26,93,221,0.55)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === 'signin' ? 'Signing in…' : 'Sign in'}
                  </button>

                  {/* OR */}
                  <div className="flex items-center gap-3 py-1">
                    <div className="h-px flex-1 bg-[#182040]" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#2e4260]">or</span>
                    <div className="h-px flex-1 bg-[#182040]" />
                  </div>

                  {/* Google */}
                  <button
                    type="button"
                    onClick={() => void handleGoogle()}
                    disabled={busy !== ''}
                    className="flex w-full items-center justify-center gap-3 rounded-xl border border-[#182040] bg-[#0b1428] py-3.5 text-sm font-semibold text-white transition-all hover:border-[#243358] hover:bg-[#0f1c34] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <GoogleIcon />
                    {busy === 'google' ? 'Connecting…' : 'Continue with Google'}
                  </button>

                  {/* Apple */}
                  <button
                    type="button"
                    onClick={() => void handleApple()}
                    disabled={busy !== ''}
                    className="flex w-full items-center justify-center gap-3 rounded-xl border border-[#182040] bg-[#0b1428] py-3.5 text-sm font-semibold text-white transition-all hover:border-[#243358] hover:bg-[#0f1c34] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <AppleIcon />
                    {busy === 'apple' ? 'Connecting…' : 'Continue with Apple'}
                  </button>

                  {/* Create account */}
                  <p className="pt-1 text-center text-sm text-[#3a5060]">
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      onClick={() =>
                        pushToast({
                          title: 'Contact your ranch admin',
                          message: 'New accounts are provisioned by workspace administrators.',
                          tone: 'info',
                        })
                      }
                      className="font-semibold text-[#1a6ddd] transition-colors hover:text-[#4090ff]"
                    >
                      Create one
                    </button>
                  </p>
                </div>
              </>
            ) : allowLocalMode ? (
              <>
                <div className="mb-6">
                  <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.28em] text-[#1a6ddd]">Browser access</div>
                  <h2 className="text-[1.8rem] font-black leading-tight tracking-[-0.03em] text-white">Open XBAR</h2>
                  <p className="mt-2 text-sm leading-6 text-[#4a6880]">
                    No account needed — open the workspace in your browser.
                  </p>
                </div>
                <button
                  type="button"
                  className="w-full rounded-xl bg-[#1a5ddd] py-3.5 text-sm font-black uppercase tracking-[0.18em] text-white shadow-[0_4px_20px_rgba(26,93,221,0.38)] transition-all hover:bg-[#1e6aff]"
                  onClick={() => navigate('/setup', { replace: true })}
                >
                  Open browser workspace
                </button>
                <p className="mt-4 text-xs leading-6 text-[#2e4260]">
                  Add{' '}
                  <code className="rounded bg-[#090e1c] px-1.5 py-0.5 text-[#3a6888]">VITE_SUPABASE_URL</code> and{' '}
                  <code className="rounded bg-[#090e1c] px-1.5 py-0.5 text-[#3a6888]">VITE_SUPABASE_ANON_KEY</code>{' '}
                  to enable cloud auth.
                </p>
              </>
            ) : (
              <>
                <div className="mb-6">
                  <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.28em] text-[#dd3a1a]">Cloud required</div>
                  <h2 className="text-[1.8rem] font-black leading-tight tracking-[-0.03em] text-white">Configuration needed</h2>
                </div>
                <div className="rounded-xl border border-[#3a1a1a]/80 bg-[#140808] px-4 py-4 text-sm leading-7 text-[#906060]">
                  Cloud auth is required. Add{' '}
                  <code className="rounded bg-[#200a0a] px-1.5 py-0.5">VITE_SUPABASE_URL</code> and{' '}
                  <code className="rounded bg-[#200a0a] px-1.5 py-0.5">VITE_SUPABASE_ANON_KEY</code>{' '}
                  to your environment, then redeploy.
                </div>
              </>
            )}

          </div>

          <p className="mt-5 text-center text-[10px] text-[#1e3048]">
            Subscription workspace · Ranch, breeding &amp; sale operations · Terms apply
          </p>
        </div>
      </div>
    </div>
  );
}

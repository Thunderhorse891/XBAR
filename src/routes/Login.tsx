import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { isCloudAuthRequired, isLocalModeEnabled, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import './authExperience.css';

type AuthMode = 'signin' | 'signup';

const productLanes = [
  { label: 'Horse ledger', value: 'Profiles, title, photos', detail: 'Verified facts stay separate from notes.' },
  { label: 'Care records', value: 'Health, Coggins, reminders', detail: 'Critical dates surface before they become fires.' },
  { label: 'Buyer rooms', value: 'Private packets, live links', detail: 'Share only what is approved and buyer-safe.' },
  { label: 'Ranch ops', value: 'Weather, expenses, assets', detail: 'The daily work lives beside the records.' },
];

const previewRows = [
  { label: 'Profile', value: 'Identity verified', tone: 'Ready' },
  { label: 'Coggins', value: 'Due window tracked', tone: 'Watch' },
  { label: 'Transfer', value: 'Packet checklist', tone: 'Clear' },
];

const trustSignals = ['Passwordless access', 'Role-aware workspace', 'Buyer-safe sharing'];

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useUiStore((state) => state.pushToast);
  const status = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);
  const sendMagicLink = useCloudStore((state) => state.sendMagicLink);
  const signInWithFacebook = useCloudStore((state) => state.signInWithFacebook);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'magic' | 'facebook' | ''>('');
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const redirectTarget = useMemo(() => {
    const next = (location.state as { from?: string } | null)?.from;
    return next || '/';
  }, [location.state]);
  const cloudRequired = isCloudAuthRequired();
  const allowLocalMode = isLocalModeEnabled();
  const supabaseReady = isSupabaseConfigured();
  const accessLabel = supabaseReady ? 'Cloud workspace' : cloudRequired ? 'Cloud required' : allowLocalMode ? 'Browser preview' : 'Cloud required';
  const primaryAction = authMode === 'signin' ? 'Email secure link' : 'Request workspace access';

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

  const handleMagicLink = async () => {
    setBusy('magic');
    const result = await sendMagicLink(email);
    pushToast({
      title: result.ok ? (authMode === 'signin' ? 'Magic link sent' : 'Access link sent') : 'Sign-in blocked',
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
    <main ref={shellRef} className="premium-auth-shell" onPointerMove={handlePointerMove}>
      <div className="premium-auth-grid" aria-hidden="true" />
      <div className="premium-auth-orb premium-auth-orb--one" aria-hidden="true" />
      <div className="premium-auth-orb premium-auth-orb--two" aria-hidden="true" />

      <div className="relative z-[1] mx-auto grid min-h-screen w-full max-w-[1440px] grid-cols-1 gap-0 px-4 py-4 lg:grid-cols-[1.05fr_0.95fr] lg:px-6 lg:py-6">
        <section className="relative hidden min-h-[calc(100vh-3rem)] overflow-hidden rounded-[30px] border border-white/10 bg-[#05080d]/80 p-8 shadow-[0_40px_120px_rgba(0,0,0,0.46)] lg:flex lg:flex-col lg:justify-between">
          <div className="premium-auth-cinematic" aria-hidden="true" />

          <div className="relative z-[1]">
            <div className="flex items-center gap-4">
              <div className="premium-brand-mark">
                <XbarMark title="XBAR logo" className="h-full w-full" />
              </div>
              <div>
                <div className="text-[1.05rem] font-extrabold uppercase tracking-[0.24em] text-white">XBAR</div>
                <div className="mt-1 text-[0.64rem] font-bold uppercase tracking-[0.36em] text-slate-400">Ranch operations OS</div>
              </div>
            </div>

            <div className="mt-20 max-w-[42rem] premium-auth-reveal">
              <h1 className="text-[clamp(3.2rem,5.8vw,6.85rem)] font-black leading-[0.86] tracking-[-0.08em] text-white">
                The operating system for modern horse operations.
              </h1>
              <p className="mt-7 max-w-[34rem] text-[1.02rem] leading-8 text-slate-300">
                Built for breeders, ranches, and serious horse owners who want their records, care cadence, and buyer flow to feel under control.
              </p>
            </div>
          </div>

          <div className="relative z-[1] grid gap-5 xl:grid-cols-[1.12fr_0.88fr]">
            <div className="premium-product-preview">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-sky-200/80">Operations cockpit</div>
                  <div className="mt-2 text-xl font-extrabold tracking-[-0.04em] text-white">One clean command layer</div>
                </div>
                <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-[0.66rem] font-bold uppercase tracking-[0.2em] text-sky-100">
                  {accessLabel}
                </span>
              </div>

              <div className="mt-7 grid gap-3">
                {previewRows.map((row) => (
                  <div key={row.label} className="grid grid-cols-[0.8fr_1fr_auto] items-center gap-4 rounded-[14px] border border-white/8 bg-white/[0.045] px-4 py-3 text-sm">
                    <span className="font-bold text-white">{row.label}</span>
                    <span className="text-slate-300">{row.value}</span>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[0.64rem] font-bold uppercase tracking-[0.16em] text-slate-200">
                      {row.tone}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3">
              {productLanes.map((lane, index) => (
                <div
                  key={lane.label}
                  className="premium-lane-card"
                  style={{ animationDelay: `${index * 90}ms` }}
                >
                  <div className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-400">{lane.label}</div>
                  <div className="mt-1 text-sm font-bold text-white">{lane.value}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">{lane.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-h-[calc(100vh-2rem)] items-center px-0 py-4 lg:min-h-[calc(100vh-3rem)] lg:px-10 lg:py-0">
          <div className="mx-auto w-full max-w-[520px]">
            <div className="mb-8 flex items-center gap-4 lg:hidden">
              <div className="premium-brand-mark premium-brand-mark--mobile">
                <XbarMark title="XBAR logo" className="h-full w-full" />
              </div>
              <div>
                <div className="text-[1rem] font-extrabold uppercase tracking-[0.22em] text-white">XBAR</div>
                <div className="mt-1 text-[0.62rem] font-bold uppercase tracking-[0.3em] text-slate-400">Ranch operations OS</div>
              </div>
            </div>

            <div className="premium-auth-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[0.66rem] font-bold uppercase tracking-[0.22em] text-slate-300">
                  {accessLabel}
                </div>
                <div className="text-[0.72rem] font-semibold text-slate-500">Private workspace access</div>
              </div>

              <div className="mt-8">
                <h2 className="text-[clamp(2.15rem,7vw,3.4rem)] font-black leading-[0.92] tracking-[-0.075em] text-white">
                  Modern ranch operations, finally organized.
                </h2>
                <p className="mt-4 text-[0.98rem] leading-7 text-slate-300">
                  Sign in, start the workspace, and move from scattered records to one clear operating layer.
                </p>
              </div>

              <div className="mt-7 grid grid-cols-2 rounded-[18px] border border-white/10 bg-black/20 p-1" role="tablist" aria-label="Authentication mode">
                {(['signin', 'signup'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={authMode === mode}
                    className={`rounded-[14px] px-4 py-3 text-sm font-bold transition duration-200 ${
                      authMode === mode ? 'bg-white text-[#07101c] shadow-[0_12px_26px_rgba(255,255,255,0.12)]' : 'text-slate-400 hover:text-white'
                    }`}
                    onClick={() => setAuthMode(mode)}
                  >
                    {mode === 'signin' ? 'Sign in' : 'Sign up'}
                  </button>
                ))}
              </div>

              {supabaseReady ? (
                <div className="mt-7">
                  <label className="field-stack">
                    <span className="field-label text-slate-300">{authMode === 'signin' ? 'Work email' : 'Owner or ops email'}</span>
                    <input
                      className="field-input premium-auth-input"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="owner@xbar.com"
                      autoComplete="email"
                    />
                  </label>

                  <div className="mt-5 grid gap-3">
                    <button
                      className="premium-auth-button premium-auth-button--primary"
                      type="button"
                      onClick={handleMagicLink}
                      disabled={busy !== '' || !email.trim()}
                    >
                      {busy === 'magic' ? 'Sending secure link...' : primaryAction}
                    </button>
                    <button
                      className="premium-auth-button premium-auth-button--ghost"
                      type="button"
                      onClick={handleFacebook}
                      disabled={busy !== ''}
                    >
                      {busy === 'facebook' ? 'Connecting...' : 'Continue with Facebook'}
                    </button>
                  </div>

                  <div className="mt-5 rounded-[18px] border border-white/10 bg-white/[0.045] px-4 py-4 text-sm leading-6 text-slate-300">
                    Passwordless login keeps access simple while cloud sync protects the workspace behind account authentication.
                  </div>
                </div>
              ) : !allowLocalMode ? (
                <div className="mt-7 rounded-[20px] border border-rose-300/25 bg-rose-500/10 px-5 py-5 text-sm leading-7 text-rose-100">
                  Cloud auth is required for this production build. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> before opening the workspace.
                </div>
              ) : (
                <div className="mt-7">
                  <div className="rounded-[20px] border border-sky-300/15 bg-sky-300/[0.07] px-5 py-5 text-sm leading-7 text-slate-200">
                    Browser preview is enabled, so you can evaluate the operating workflow before cloud auth is connected.
                  </div>
                  <div className="mt-5 grid gap-3">
                    <button className="premium-auth-button premium-auth-button--primary" type="button" onClick={() => navigate('/setup', { replace: true })}>
                      Open browser workspace
                    </button>
                    <button className="premium-auth-button premium-auth-button--ghost" type="button" onClick={() => navigate('/setup', { replace: true })}>
                      Preview onboarding
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-7 grid gap-2 sm:grid-cols-3">
                {trustSignals.map((signal) => (
                  <div key={signal} className="rounded-[14px] border border-white/10 bg-white/[0.035] px-3 py-3 text-center text-[0.7rem] font-bold uppercase tracking-[0.16em] text-slate-300">
                    {signal}
                  </div>
                ))}
              </div>

              <div className="mt-6 text-xs leading-6 text-slate-500">
                By continuing, you agree to the workspace terms, privacy notice, and subscription billing terms that govern this account.
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {['Breeders', 'Ranch teams', 'Serious owners'].map((label) => (
                <div key={label} className="rounded-[16px] border border-white/10 bg-white/[0.035] px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

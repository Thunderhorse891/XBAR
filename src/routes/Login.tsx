import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Pill } from '@/components/app-ui';
import { isCloudAuthRequired, isLocalModeEnabled, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useUiStore((state) => state.pushToast);
  const status = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);
  const sendMagicLink = useCloudStore((state) => state.sendMagicLink);
  const signInWithFacebook = useCloudStore((state) => state.signInWithFacebook);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'magic' | 'facebook' | ''>('');
  const redirectTarget = useMemo(() => {
    const next = (location.state as { from?: string } | null)?.from;
    return next || '/';
  }, [location.state]);
  const cloudRequired = isCloudAuthRequired();
  const allowLocalMode = isLocalModeEnabled();
  const authLabel = isSupabaseConfigured() ? 'Cloud live' : allowLocalMode ? 'Browser access' : 'Cloud required';
  const syncLabel = isSupabaseConfigured() ? 'Cloud autosave' : 'Browser storage';

  useEffect(() => {
    if (session && status === 'signed-in') {
      navigate(redirectTarget, { replace: true });
    }
  }, [navigate, redirectTarget, session, status]);

  const handleMagicLink = async () => {
    setBusy('magic');
    const result = await sendMagicLink(email);
    pushToast({
      title: result.ok ? 'Magic link sent' : 'Sign-in blocked',
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
    <div className="min-h-screen bg-[linear-gradient(180deg,#f7fafc_0%,#eef3f8_100%)] px-5 py-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1280px] items-stretch overflow-hidden rounded-[28px] border border-[#dbe4ed] bg-white shadow-[0_40px_80px_rgba(15,23,42,0.08)]">
        <section className="relative hidden w-[52%] overflow-hidden border-r border-[#e4ebf2] bg-[radial-gradient(circle_at_top_right,rgba(12,111,151,0.16),transparent_28%),linear-gradient(180deg,#fbfdff_0%,#eff5f9_100%)] p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-y-0 right-[-90px] w-[240px] rounded-full bg-[rgba(12,111,151,0.08)] blur-3xl" aria-hidden="true" />
          <div className="relative z-[1]">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d8e1ea] bg-white p-1.5 shadow-sm">
                <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" className="h-full w-full object-contain" />
              </div>
              <div>
                <div className="text-lg font-extrabold uppercase tracking-[0.14em]">XBAR</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7e8891]">Private ranch software</div>
              </div>
            </div>

            <div className="mt-14 max-w-[34rem]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7e8891]">Login</div>
              <h1 className="mt-4 text-[clamp(2.8rem,4vw,4.5rem)] font-extrabold leading-[0.95] tracking-[-0.08em] text-[#1e242b]">
                Private ranch software for horses, paperwork, and buyers.
              </h1>
              <p className="mt-5 max-w-[28rem] text-[15px] leading-7 text-[#586673]">
                Built for ranches, breeders, and sale teams that need clean records, clean packet flow, and clear access.
              </p>
            </div>
          </div>

          <div className="relative z-[1] max-w-[34rem] border-t border-[#e4ebf2] pt-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 border-b border-[#edf2f7] pb-4">
                <span className="text-sm font-semibold text-[#1e242b]">Horse desk</span>
                <span className="text-sm text-[#5f6c79]">Sale, care, title</span>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-[#edf2f7] pb-4">
                <span className="text-sm font-semibold text-[#1e242b]">Document intake</span>
                <span className="text-sm text-[#5f6c79]">Packet, trust, review</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-semibold text-[#1e242b]">Ranch desk</span>
                <span className="text-sm text-[#5f6c79]">Weather, care, budget</span>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              <span className="inline-flex min-h-[28px] items-center rounded-full border border-[#dbe4ed] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#4f6070]">
                {authLabel}
              </span>
              <span className="inline-flex min-h-[28px] items-center rounded-full border border-[#dbe4ed] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#4f6070]">
                Role aware
              </span>
              <span className="inline-flex min-h-[28px] items-center rounded-full border border-[#dbe4ed] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#4f6070]">
                {syncLabel}
              </span>
            </div>
            <div className="mt-4 max-w-[30rem] text-[12px] leading-6 text-[#7b8894]">
              Subscription workspace for ranch, breeding, and sale operations. Terms, privacy, and billing apply to account use.
            </div>
          </div>
        </section>

        <section className="flex flex-1 items-center bg-white px-6 py-8 lg:px-12">
          <div className="mx-auto w-full max-w-[460px]">
            <div className="lg:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#dbe4ed] bg-[#f7fafc] p-1.5 shadow-sm">
                  <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" className="h-full w-full object-contain" />
                </div>
                <div>
                  <div className="text-base font-extrabold uppercase tracking-[0.14em] text-[#1e242b]">XBAR</div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7e8891]">Private ranch software</div>
                </div>
              </div>
            </div>

            <div className="mt-8 lg:mt-0">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7e8891]">Workspace access</div>
                  <h2 className="mt-2 text-[1.95rem] font-extrabold tracking-[-0.06em] text-[#1e242b]">Enter XBAR</h2>
                </div>
                <Pill tone={isSupabaseConfigured() ? 'blue' : cloudRequired ? 'rose' : 'slate'}>
                  {isSupabaseConfigured() ? 'Secure login' : cloudRequired ? 'Cloud required' : 'Browser access'}
                </Pill>
              </div>
              <p className="mt-3 max-w-[28rem] text-sm leading-7 text-[#5f6c79]">
                Sign in to sync the workspace, or open browser access when cloud auth is not enabled yet.
              </p>
            </div>

            {isSupabaseConfigured() ? (
              <div className="mt-8 rounded-[24px] border border-[#dbe4ed] bg-[#fbfdff] p-6 shadow-sm">
                <label className="field-stack">
                  <span className="field-label">Email</span>
                  <input
                    className="field-input"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="owner@xbar.com"
                  />
                </label>

                <div className="mt-5 flex flex-col gap-3">
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={handleMagicLink}
                    disabled={busy !== '' || !email.trim()}
                  >
                    {busy === 'magic' ? 'Sending...' : 'Send magic link'}
                  </button>
                  <button
                    className="button button--ghost"
                    type="button"
                    onClick={handleFacebook}
                    disabled={busy !== ''}
                  >
                    {busy === 'facebook' ? 'Connecting...' : 'Continue with Facebook'}
                  </button>
                </div>

                <div className="mt-5 rounded-[18px] border border-[#e3ebf2] bg-white px-4 py-4 text-sm leading-6 text-[#50606d]">
                  Email sends a secure login link. Facebook is available when that workspace connector is enabled.
                </div>
                <div className="mt-4 text-xs leading-6 text-[#7a8794]">
                  By continuing, you agree to the workspace terms, privacy notice, and subscription billing terms that govern this account.
                </div>
              </div>
            ) : !allowLocalMode ? (
              <div className="mt-8 rounded-[24px] border border-[#e5c7c7] bg-[#fff4f4] px-5 py-5 text-sm leading-7 text-[#7b3a3a] shadow-sm">
                Cloud auth is required for this production build. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> before opening the workspace.
              </div>
            ) : (
              <div className="mt-8 rounded-[24px] border border-[#dbe4ed] bg-[#fbfdff] p-6 shadow-sm">
                <div className="rounded-[18px] border border-[#e3ebf2] bg-white px-4 py-4 text-sm leading-7 text-[#50606d]">
                  Browser access is available right now, so you can open the workspace without waiting on cloud auth.
                </div>
                <div className="mt-5 flex flex-col gap-3">
                  <button className="button button--primary" type="button" onClick={() => navigate('/setup', { replace: true })}>
                    Open browser workspace
                  </button>
                  <div className="text-sm leading-6 text-[#647281]">
                    Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> when you want real user login.
                  </div>
                </div>
                <div className="mt-4 text-xs leading-6 text-[#7a8794]">
                  Browser access is for workspace setup and preview. Production use should run behind configured account, privacy, and billing terms.
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

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
    <div className="min-h-screen bg-[#f4f7fb] px-5 py-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1180px] gap-6 lg:grid-cols-[0.95fr,1.05fr]">
        <section className="flex flex-col justify-between rounded-2xl border border-[#d8e1ea] bg-[linear-gradient(145deg,#ffffff_0%,#eff4f8_100%)] p-8 text-[#1e242b] shadow-sm">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-[#d8e1ea] bg-white p-1.5 shadow-sm">
                <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" className="h-full w-full object-contain" />
              </div>
              <div>
                <div className="text-lg font-extrabold uppercase tracking-[0.14em]">XBAR</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7e8891]">Horse Ledger</div>
              </div>
            </div>

            <div className="mt-10">
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7e8891]">Secure access</div>
              <h1 className="mt-3 text-[clamp(2.3rem,4vw,4rem)] font-bold tracking-[-0.07em] text-[#1e242b]">Sign in</h1>
              <p className="mt-4 max-w-[28rem] text-sm leading-7 text-[#5d6670]">
                Access the XBAR workspace, sync cloud records, and manage buyer-safe horse files from one account.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[#d8e1ea] bg-white/80 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#7e8891]">Auth</div>
              <div className="mt-2 text-sm font-semibold text-[#1e242b]">
                {isSupabaseConfigured() ? 'Supabase live' : allowLocalMode ? 'Browser access' : 'Cloud required'}
              </div>
            </div>
            <div className="rounded-xl border border-[#d8e1ea] bg-white/80 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#7e8891]">Access</div>
              <div className="mt-2 text-sm font-semibold text-[#1e242b]">Role-aware</div>
            </div>
            <div className="rounded-xl border border-[#d8e1ea] bg-white/80 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#7e8891]">Sync</div>
              <div className="mt-2 text-sm font-semibold text-[#1e242b]">{isSupabaseConfigured() ? 'Cloud autosave' : 'Browser storage'}</div>
            </div>
          </div>
        </section>

        <section className="flex items-center">
          <div className="w-full rounded-2xl border border-[#d8e1ea] bg-white p-8 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7e8891]">Workspace login</div>
                <h2 className="mt-2 text-[1.7rem] font-bold tracking-[-0.05em] text-[#1e242b]">Enter XBAR</h2>
              </div>
              <Pill tone={isSupabaseConfigured() ? 'blue' : cloudRequired ? 'rose' : 'slate'}>
                {isSupabaseConfigured() ? 'Secure login' : cloudRequired ? 'Secure login required' : 'Browser access'}
              </Pill>
            </div>

            {isSupabaseConfigured() ? (
              <>
                <div className="mt-8 grid gap-4">
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
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
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

                <div className="mt-6 rounded-xl border border-[#dbe5eb] bg-[#f2f8fb] px-4 py-4 text-sm leading-6 text-[#50606d]">
                  Use your email to receive a secure sign-in link, or continue with Facebook if your workspace enables that connector.
                </div>
              </>
            ) : (
              cloudRequired ? (
                <div className="mt-8 rounded-xl border border-[#e5c7c7] bg-[#fff4f4] px-4 py-4 text-sm leading-7 text-[#7b3a3a]">
                  Cloud auth is required for this production build. Add
                  {' '}
                  <code>VITE_SUPABASE_URL</code>
                  {' '}
                  and
                  {' '}
                  <code>VITE_SUPABASE_ANON_KEY</code>
                  {' '}
                  before opening the workspace.
                </div>
              ) : (
                <div className="mt-8 rounded-xl border border-[#d8e1ea] bg-[#eff4f8] px-4 py-4 text-sm leading-7 text-[#4f6272]">
                  This build is using browser access so you can open the workspace without cloud login. Add
                  {' '}
                  <code>VITE_SUPABASE_URL</code>
                  {' '}
                  and
                  {' '}
                  <code>VITE_SUPABASE_ANON_KEY</code>
                  {' '}
                  to turn on real user login.
                </div>
              )
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

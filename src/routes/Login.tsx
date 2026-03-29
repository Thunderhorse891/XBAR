import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Pill } from '@/components/app-ui';
import { isSupabaseConfigured } from '@/lib/platformConfig';
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
    <div className="min-h-screen bg-[#f4f1ec] px-5 py-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1180px] gap-6 lg:grid-cols-[0.95fr,1.05fr]">
        <section className="flex flex-col justify-between rounded-2xl border border-[#4c4036] bg-[#312a24] p-8 text-white shadow-sm">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-[#5d5146] bg-white/[0.03] p-1.5">
                <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" className="h-full w-full object-contain" />
              </div>
              <div>
                <div className="text-lg font-extrabold uppercase tracking-[0.14em]">XBAR</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#b7a99b]">Horse Ledger</div>
              </div>
            </div>

            <div className="mt-10">
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#b7a99b]">Secure access</div>
              <h1 className="mt-3 text-[clamp(2.3rem,4vw,4rem)] font-bold tracking-[-0.07em] text-white">Sign in</h1>
              <p className="mt-4 max-w-[28rem] text-sm leading-7 text-[#d6cbc0]">
                Access the XBAR workspace, sync cloud records, and manage buyer-safe horse files from one account.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[#5d5146] bg-white/[0.03] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#b7a99b]">Auth</div>
              <div className="mt-2 text-sm font-semibold text-white">{isSupabaseConfigured() ? 'Supabase live' : 'Local mode'}</div>
            </div>
            <div className="rounded-xl border border-[#5d5146] bg-white/[0.03] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#b7a99b]">Access</div>
              <div className="mt-2 text-sm font-semibold text-white">Role-aware</div>
            </div>
            <div className="rounded-xl border border-[#5d5146] bg-white/[0.03] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#b7a99b]">Sync</div>
              <div className="mt-2 text-sm font-semibold text-white">Cloud autosave</div>
            </div>
          </div>
        </section>

        <section className="flex items-center">
          <div className="w-full rounded-2xl border border-[#ddd3c7] bg-[#fffdfa] p-8 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8f8378]">Workspace login</div>
                <h2 className="mt-2 text-[1.7rem] font-bold tracking-[-0.05em] text-[#201d1a]">Enter XBAR</h2>
              </div>
              <Pill tone={isSupabaseConfigured() ? 'blue' : 'slate'}>{isSupabaseConfigured() ? 'Cloud auth' : 'Local only'}</Pill>
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

                <div className="mt-6 rounded-xl border border-[#e3dbd0] bg-[#f8f3ec] px-4 py-4 text-sm leading-6 text-[#5c5147]">
                  Use your email to receive a secure sign-in link, or continue with Facebook if your workspace enables that connector.
                </div>
              </>
            ) : (
              <div className="mt-8 rounded-xl border border-[#e3dbd0] bg-[#f8f3ec] px-4 py-4 text-sm leading-7 text-[#5c5147]">
                Supabase auth is not configured for this build yet, so this app is currently running in local workspace mode. Add
                {' '}
                <code>VITE_SUPABASE_URL</code>
                {' '}
                and
                {' '}
                <code>VITE_SUPABASE_ANON_KEY</code>
                {' '}
                to turn on real user login.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

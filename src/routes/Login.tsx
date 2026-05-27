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
    <div className="min-h-screen bg-[#060d1a]">
      <div className="mx-auto flex min-h-screen max-w-[1400px] lg:grid lg:grid-cols-[1fr,480px]">

        {/* Left — dark brand panel */}
        <section className="relative hidden overflow-hidden bg-[#060d1a] p-14 lg:flex lg:flex-col lg:justify-between">
          {/* Subtle blue glow top-right */}
          <div className="pointer-events-none absolute right-0 top-0 h-[420px] w-[420px] rounded-full bg-[#1155dd] opacity-[0.07] blur-[120px]" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-[300px] w-[300px] rounded-full bg-[#1155dd] opacity-[0.05] blur-[100px]" />

          <div className="relative z-10">
            {/* Logo lockup */}
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#1a2e46] bg-[#080f1e] p-1.5 shadow-[0_0_0_1px_rgba(17,85,221,0.15),0_8px_24px_rgba(0,0,0,0.4)]">
                <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR" className="h-full w-full object-contain" />
              </div>
              <div>
                <div className="text-lg font-extrabold uppercase tracking-[0.16em] text-white">XBAR</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#3d5c78]">Private ranch software</div>
              </div>
            </div>

            {/* Headline */}
            <div className="mt-16 max-w-[520px]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#3d5c78]">Built for ranches</div>
              <h1 className="mt-5 text-[clamp(2.6rem,3.8vw,4.2rem)] font-extrabold leading-[0.94] tracking-[-0.07em] text-white">
                Horses, paperwork,<br />and buyers.
              </h1>
              <p className="mt-6 max-w-[400px] text-[15px] leading-[1.75] text-[#6080a0]">
                Clean records, trusted packets, and clear access — for ranches, breeders, and sale teams.
              </p>
            </div>
          </div>

          {/* Feature list */}
          <div className="relative z-10 max-w-[480px]">
            <div className="mb-8 h-px bg-[linear-gradient(90deg,#1a2e46,transparent)]" />
            <div className="space-y-5">
              {[
                { label: 'Horse desk', detail: 'Sale, care, and title in one view' },
                { label: 'Document intake', detail: 'Packet trust, bulk review, duplicate flags' },
                { label: 'Ranch desk', detail: 'Weather, care cadence, and budget' },
              ].map(({ label, detail }) => (
                <div key={label} className="flex items-center justify-between gap-6">
                  <span className="text-sm font-semibold text-[#c2d4e8]">{label}</span>
                  <span className="text-sm text-[#3d5c78]">{detail}</span>
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {['Role aware', 'Buyer safe', 'AQHA ready'].map((tag) => (
                <span key={tag} className="inline-flex min-h-[26px] items-center rounded-full border border-[#162436] bg-[#0c1a2e] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4a6880]">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Right — entry panel */}
        <section className="flex min-h-screen flex-col justify-center bg-white px-8 py-12 lg:px-12">
          {/* Mobile logo */}
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#1a2e46] bg-[#060d1a] p-1.5">
              <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR" className="h-full w-full object-contain" />
            </div>
            <div className="text-base font-extrabold uppercase tracking-[0.14em] text-[#1e242b]">XBAR</div>
          </div>

          <div className="w-full max-w-[400px] lg:mx-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7e8891]">Workspace access</div>
                <h2 className="mt-2 text-[2rem] font-extrabold tracking-[-0.06em] text-[#1e242b]">Enter XBAR</h2>
              </div>
              <Pill tone={isSupabaseConfigured() ? 'blue' : cloudRequired ? 'rose' : 'slate'}>
                {isSupabaseConfigured() ? 'Secure login' : cloudRequired ? 'Cloud required' : 'Browser access'}
              </Pill>
            </div>
            <p className="mt-3 text-sm leading-7 text-[#5f6c79]">
              {isSupabaseConfigured()
                ? 'Sign in with your email or connected account.'
                : allowLocalMode
                  ? 'Open the workspace in your browser — no account needed yet.'
                  : 'Cloud auth is required. Configure Supabase to unlock the workspace.'}
            </p>

            <div className="mt-8">
              {isSupabaseConfigured() ? (
                <div className="space-y-4">
                  <label className="field-stack">
                    <span className="field-label">Email</span>
                    <input
                      className="field-input"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="owner@xbar.com"
                      autoFocus
                    />
                  </label>
                  <button
                    className="button button--primary w-full"
                    type="button"
                    onClick={handleMagicLink}
                    disabled={busy !== '' || !email.trim()}
                  >
                    {busy === 'magic' ? 'Sending...' : 'Send magic link'}
                  </button>
                  <button
                    className="button button--ghost w-full"
                    type="button"
                    onClick={handleFacebook}
                    disabled={busy !== ''}
                  >
                    {busy === 'facebook' ? 'Connecting...' : 'Continue with Facebook'}
                  </button>
                </div>
              ) : allowLocalMode ? (
                <div className="space-y-4">
                  <button
                    className="button button--primary w-full"
                    type="button"
                    onClick={() => navigate('/setup', { replace: true })}
                  >
                    Open browser workspace
                  </button>
                  <p className="text-xs leading-6 text-[#8a96a4]">
                    Add <code className="rounded bg-[#f4f7fb] px-1.5 py-0.5 text-[#3a5c80]">VITE_SUPABASE_URL</code> and <code className="rounded bg-[#f4f7fb] px-1.5 py-0.5 text-[#3a5c80]">VITE_SUPABASE_ANON_KEY</code> when you want real user login.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-[#f0d0d0] bg-[#fff6f6] px-5 py-5 text-sm leading-7 text-[#7b3a3a]">
                  Cloud auth is required. Add <code className="rounded bg-[#fde8e8] px-1.5 py-0.5">VITE_SUPABASE_URL</code> and <code className="rounded bg-[#fde8e8] px-1.5 py-0.5">VITE_SUPABASE_ANON_KEY</code> to your environment, then redeploy.
                </div>
              )}
            </div>

            <div className="mt-10 border-t border-[#edf2f7] pt-6 text-[11px] leading-6 text-[#9aa4ae]">
              Subscription workspace for ranch, breeding, and sale operations. Terms and billing apply.
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}

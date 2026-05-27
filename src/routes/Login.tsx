import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { isLocalModeEnabled, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import './authExperience.css';

type AuthMode = 'signin' | 'signup';
type BusyState = 'password' | 'magic' | 'facebook' | 'reset' | '';

const loginReferenceStyles = `
.xbar-login-shell--command{min-height:100vh;padding:clamp(18px,2.2vw,30px);background:radial-gradient(circle at 22% 18%,rgba(34,134,255,.28),transparent 25rem),radial-gradient(circle at 42% 70%,rgba(235,179,91,.12),transparent 24rem),linear-gradient(115deg,#020408 0%,#09111b 46%,#020305 100%)}
.xbar-login-command-frame{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.48fr) minmax(390px,.9fr);gap:clamp(28px,5vw,70px);min-height:calc(100vh - clamp(36px,4.4vw,60px));overflow:hidden;border:1px solid rgba(142,170,204,.26);border-radius:18px;background:linear-gradient(90deg,rgba(2,4,8,.04),rgba(2,4,8,.98)),radial-gradient(circle at 28% 38%,rgba(52,148,255,.2),transparent 23rem),radial-gradient(circle at 38% 69%,rgba(243,213,170,.14),transparent 22rem),rgba(1,3,7,.96);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 32px 100px rgba(0,0,0,.74)}
.xbar-login-command-frame:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.035),transparent 24%),repeating-radial-gradient(circle at 16% 42%,rgba(255,149,71,.45) 0 1px,transparent 2px 96px);opacity:.22}
.xbar-login-command-frame .xbar-login-brand-panel{min-height:auto;border:0;border-radius:0;background:transparent;box-shadow:none;padding:clamp(34px,5vw,78px) clamp(18px,4vw,56px);justify-content:center;gap:clamp(34px,5vw,66px)}
.xbar-login-command-frame .xbar-login-brand-panel:after{display:none}.xbar-login-brand-stage{position:relative;z-index:1;display:grid;justify-items:center;text-align:center}.xbar-login-horse-emblem{width:clamp(168px,19vw,280px);height:clamp(168px,19vw,280px);display:grid;place-items:center;margin-bottom:clamp(-22px,-2vw,-10px);filter:drop-shadow(0 0 28px rgba(42,145,255,.55))}.xbar-login-horse-emblem svg{width:100%;height:100%}
.xbar-login-chrome-wordmark{color:#f8fbff;font-size:clamp(74px,10vw,150px);line-height:.9;font-weight:950;letter-spacing:.11em;text-shadow:0 0 20px rgba(38,143,255,.52),0 12px 42px rgba(0,0,0,.78)}
.xbar-login-reference-line{margin:24px 0 0;color:rgba(242,247,255,.95);font-size:clamp(16px,1.8vw,24px);font-weight:760;letter-spacing:.23em;text-transform:uppercase}.xbar-login-reference-line strong{display:block;margin-bottom:8px;color:#2d8cff;text-shadow:0 0 18px rgba(45,140,255,.5)}.xbar-login-reference-line span{display:block}
.xbar-login-feature-row{position:relative;z-index:1;display:grid;grid-template-columns:repeat(5,minmax(82px,1fr));max-width:760px;width:100%;margin:0 auto}.xbar-login-feature-tile{min-height:94px;display:grid;place-items:center;align-content:center;gap:9px;padding:10px;border-right:1px solid rgba(191,211,233,.18);color:#dce8f5;text-align:center;font-size:10px;font-weight:850;letter-spacing:.08em;line-height:1.25;text-transform:uppercase}.xbar-login-feature-tile:last-child{border-right:0}.xbar-login-feature-tile svg{width:34px;height:34px;opacity:.94}
.xbar-login-built-for{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;gap:18px;width:min(520px,100%);min-height:78px;margin:0 auto;border:1px solid rgba(128,166,207,.32);border-radius:10px;background:rgba(8,15,24,.7);color:#dfeaff;font-size:clamp(13px,1.3vw,18px);font-weight:850;letter-spacing:.18em;line-height:1.45;text-transform:uppercase;box-shadow:0 0 32px rgba(45,140,255,.16),inset 0 1px 0 rgba(255,255,255,.06)}.xbar-login-built-for svg{width:36px;height:36px;flex:0 0 auto;color:#dce8f5}
.xbar-login-command-frame .xbar-login-auth-panel{position:relative;z-index:1;min-height:auto;padding:clamp(24px,4vw,72px) clamp(20px,4vw,56px) clamp(24px,4vw,72px) 0}.xbar-login-command-frame .xbar-login-card{width:min(100%,542px);margin-left:auto;padding:clamp(30px,4vw,58px);border:1px solid rgba(157,187,222,.48);border-radius:18px;background:radial-gradient(circle at 52% 0%,rgba(45,140,255,.2),transparent 12rem),linear-gradient(145deg,rgba(18,29,41,.9),rgba(4,8,13,.84));box-shadow:0 30px 90px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(24px)}
.xbar-login-command-frame .xbar-login-card:before{content:"";position:absolute;top:-1px;left:38%;width:120px;height:1px;background:linear-gradient(90deg,transparent,#4da2ff,transparent);box-shadow:0 0 20px #2d8cff}.xbar-login-command-frame .xbar-login-card-copy{margin-top:0}.xbar-login-welcome{color:#2d8cff;font-size:14px;font-weight:850;letter-spacing:.31em;text-transform:uppercase}.xbar-login-command-frame .xbar-login-card-copy h2{margin-top:14px;font-size:clamp(30px,3vw,42px);line-height:1.08;letter-spacing:-.02em}.xbar-login-command-frame .xbar-login-card-copy p{margin-top:12px;color:rgba(213,224,238,.78);font-size:17px}
.xbar-login-command-frame .xbar-login-form{margin-top:36px;gap:18px}.xbar-login-command-frame .xbar-login-field{gap:11px}.xbar-login-command-frame .xbar-login-field span{color:#dfe8f4;font-size:12px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.xbar-login-command-frame .xbar-login-field input{min-height:54px;border-color:rgba(143,169,199,.38);border-radius:8px;background:rgba(2,7,13,.62);color:#f8fbff;font-size:16px}.xbar-login-options-row,.xbar-login-mode-switch{display:flex;align-items:center;justify-content:space-between;gap:14px;color:#b9c5d5;font-size:14px}.xbar-login-remember{display:inline-flex;align-items:center;gap:10px}.xbar-login-remember input{width:18px;height:18px;accent-color:#2d8cff}.xbar-login-options-row button,.xbar-login-mode-switch button{color:#3696ff;background:transparent;cursor:pointer;font-weight:600}
.xbar-login-command-frame .xbar-login-primary{min-height:56px;border:1px solid rgba(103,173,255,.6);border-radius:8px;background:linear-gradient(180deg,#2d8cff 0%,#1764df 100%);color:white;font-size:14px;letter-spacing:.14em;text-transform:uppercase;box-shadow:0 16px 34px rgba(22,99,223,.42),inset 0 1px 0 rgba(255,255,255,.26)}.xbar-login-divider{display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:center;color:#8391a6;font-size:12px;letter-spacing:.12em}.xbar-login-divider:before,.xbar-login-divider:after{content:"";height:1px;background:rgba(160,177,198,.16)}.xbar-login-command-frame .xbar-login-facebook{min-height:52px;border-radius:8px;letter-spacing:.08em;text-transform:uppercase}.xbar-login-local-mode{margin-top:30px}
@media(max-width:1120px){.xbar-login-command-frame{grid-template-columns:1fr}.xbar-login-command-frame .xbar-login-auth-panel{padding:0 clamp(20px,5vw,56px) clamp(28px,5vw,56px)}.xbar-login-command-frame .xbar-login-card{margin:0 auto}}@media(max-width:760px){.xbar-login-shell--command{padding:0}.xbar-login-command-frame{min-height:100vh;border-radius:0}.xbar-login-command-frame .xbar-login-brand-panel{padding:28px 18px 16px}.xbar-login-chrome-wordmark{font-size:clamp(54px,17vw,86px)}.xbar-login-feature-row{grid-template-columns:repeat(2,minmax(0,1fr))}.xbar-login-feature-tile{border-right:0;border-bottom:1px solid rgba(191,211,233,.15)}.xbar-login-built-for{font-size:12px;letter-spacing:.12em;padding:12px}.xbar-login-command-frame .xbar-login-auth-panel{padding:0 16px 22px}.xbar-login-options-row,.xbar-login-mode-switch{align-items:flex-start;flex-direction:column}}
`;

const featureProof = [
  { label: 'Horse Management', icon: 'horse' },
  { label: 'Health & Compliance', icon: 'shield' },
  { label: 'Documents & Records', icon: 'document' },
  { label: 'Expenses & Reports', icon: 'dollar' },
  { label: 'Ownership & Transfers', icon: 'people' },
] as const;

function FeatureIcon({ icon }: { icon: (typeof featureProof)[number]['icon'] }) {
  const paths = {
    horse: 'M4 17c1.2-5 4.8-8.5 9.7-9.6 2-.4 4.2.5 5.3 2.4.8 1.3 1 3.3.3 5.1l-1.2 3.1m-9.4-2.6h5.4M7.5 18h10.2M9.2 9.2 7.5 6.7m5.8 1.1 1.5-2.6',
    shield: 'M12 3.4 19 6v5.4c0 4.3-2.6 7.5-7 9.2-4.4-1.7-7-4.9-7-9.2V6l7-2.6Zm-3.1 8.4 2 2 4.4-4.8',
    document: 'M7 3.8h7.1L18 7.7v12.5H7V3.8Zm7 0v4h4M9.8 12h4.6M9.8 15.5h5.8',
    dollar: 'M12 4v16m4-11.8c-.8-1-2.2-1.6-4-1.6-2.2 0-3.7 1-3.7 2.5 0 1.7 1.8 2.3 3.8 2.8 2.1.5 3.9 1.1 3.9 2.9 0 1.6-1.7 2.8-4 2.8-1.8 0-3.5-.6-4.5-1.8',
    people: 'M8.8 18.7c.2-2.5 1.8-4.1 3.7-4.1s3.5 1.6 3.7 4.1M12.5 12.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM4 18.5c.2-2 1.5-3.4 3.1-3.8M20 18.5c-.2-2-1.5-3.4-3.1-3.8',
  };
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={paths[icon]} stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

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
  const redirectTarget = useMemo(() => (location.state as { from?: string } | null)?.from || '/', [location.state]);
  const allowLocalMode = isLocalModeEnabled();
  const supabaseReady = isSupabaseConfigured();
  const passwordActionLabel = authMode === 'signin' ? 'Sign in' : 'Create account';

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

  const handlePasswordAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('password');
    const result = authMode === 'signin' ? await signInWithPassword(email, password) : await signUpWithPassword(email, password);
    pushToast({ title: result.ok ? (authMode === 'signin' ? 'Signed in' : 'Account created') : authMode === 'signin' ? 'Sign-in blocked' : 'Signup blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    setBusy('');
  };
  const handleMagicLink = async () => { setBusy('magic'); const result = await sendMagicLink(email); pushToast({ title: result.ok ? 'Secure link sent' : 'Secure link blocked', message: result.message, tone: result.ok ? 'success' : 'error' }); setBusy(''); };
  const handlePasswordReset = async () => { setBusy('reset'); const result = await sendPasswordReset(email); pushToast({ title: result.ok ? 'Reset email sent' : 'Reset blocked', message: result.message, tone: result.ok ? 'success' : 'error' }); setBusy(''); };
  const handleFacebook = async () => { setBusy('facebook'); const result = await signInWithFacebook(); pushToast({ title: result.ok ? 'Facebook sign-in started' : 'Facebook sign-in failed', message: result.message, tone: result.ok ? 'success' : 'error' }); setBusy(''); };

  return (
    <main ref={shellRef} className="xbar-login-shell xbar-login-shell--command" onPointerMove={handlePointerMove}>
      <style>{loginReferenceStyles}</style><div className="xbar-login-noise" aria-hidden="true" />
      <div className="xbar-login-command-frame">
        <section className="xbar-login-brand-panel" aria-labelledby="xbar-login-headline">
          <div className="xbar-login-brand-stage" aria-hidden="true"><div className="xbar-login-horse-emblem"><XbarMark title="XBAR logo" className="h-full w-full" /></div><div className="xbar-login-chrome-wordmark">XBAR</div><p id="xbar-login-headline" className="xbar-login-reference-line"><strong>The operating system</strong><span>for modern horse operations</span></p></div>
          <div className="xbar-login-feature-row" aria-label="XBAR product coverage">{featureProof.map((item) => <div key={item.label} className="xbar-login-feature-tile"><FeatureIcon icon={item.icon} /><span>{item.label}</span></div>)}</div>
          <div className="xbar-login-built-for"><FeatureIcon icon="shield" /><span>Built for ranches, breeders, and serious horse owners.</span></div>
        </section>
        <section className="xbar-login-auth-panel" aria-label="Workspace access"><div className="xbar-login-card"><div className="xbar-login-card-copy"><span className="xbar-login-welcome">Welcome Back</span><h2>{authMode === 'signin' ? 'Sign in to your account' : 'Create your XBAR account'}</h2><p>Access your ranch. Your horses. Your records.</p></div>
          {supabaseReady ? <form className="xbar-login-form" onSubmit={handlePasswordAuth}><label className="xbar-login-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label><label className="xbar-login-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="**********" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} /></label><div className="xbar-login-options-row"><label className="xbar-login-remember"><input type="checkbox" /><span>Remember me</span></label>{authMode === 'signin' ? <button type="button" onClick={handlePasswordReset} disabled={busy !== '' || !email.trim()}>{busy === 'reset' ? 'Sending...' : 'Forgot password?'}</button> : null}</div><button className="xbar-login-primary" type="submit" disabled={busy !== '' || !email.trim() || !password}>{busy === 'password' ? 'Checking access...' : passwordActionLabel}</button><div className="xbar-login-divider"><span>OR</span></div><button className="xbar-login-facebook" type="button" onClick={handleMagicLink} disabled={busy !== '' || !email.trim()}>{busy === 'magic' ? 'Sending secure link...' : 'Email secure link'}</button><button className="xbar-login-facebook" type="button" onClick={handleFacebook} disabled={busy !== ''}>{busy === 'facebook' ? 'Connecting...' : 'Continue with Facebook'}</button><div className="xbar-login-mode-switch"><span>{authMode === 'signin' ? "Don't have an account?" : 'Already have an account?'}</span><button type="button" onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}>{authMode === 'signin' ? 'Create one' : 'Sign in'}</button></div></form> : !allowLocalMode ? <div className="xbar-login-auth-note xbar-login-auth-note--blocked">Cloud auth is required for this build. Add Supabase URL and anon key before opening the workspace.</div> : <div className="xbar-login-local-mode"><div className="xbar-login-auth-note">Browser preview is enabled. You can review the workspace locally before cloud auth is connected.</div><button className="xbar-login-primary" type="button" onClick={() => navigate('/setup', { replace: true })}>Open browser workspace</button><button className="xbar-login-facebook" type="button" onClick={() => navigate('/setup', { replace: true })}>Preview onboarding</button></div>}
        </div></section>
      </div>
    </main>
  );
}

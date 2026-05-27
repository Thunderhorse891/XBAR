import { type FormEvent, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { isStaticPreviewHost, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useWorkspaceReady, useXbarStore } from '@/store/useXbarStore';
import './authExperience.css';

const foundationSteps = [
  {
    title: 'Name the operation',
    body: 'Set the business, ranch, and operating contact that anchors the workspace.',
  },
  {
    title: 'Keep records honest',
    body: 'Start with an empty ledger so every horse, document, and owner field is verified.',
  },
  {
    title: 'Open the command layer',
    body: 'Move into horse profiles, care dates, buyer rooms, expenses, weather, and transfer work.',
  },
];

const workspacePreviews = [
  { label: 'Horse profiles', value: 'Identity, media, title, notes' },
  { label: 'Breeding records', value: 'Contracts, milestones, foaling windows' },
  { label: 'Care cadence', value: 'Coggins, dental, vaccines, blockers' },
  { label: 'Ranch clarity', value: 'Expenses, assets, weather, team roles' },
];

export default function SetupWorkspace() {
  const navigate = useNavigate();
  const workspaceReady = useWorkspaceReady();
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const initializeWorkspace = useXbarStore((state) => state.initializeWorkspace);
  const status = useCloudStore((state) => state.status);
  const pushToast = useUiStore((state) => state.pushToast);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    businessName: workspaceProfile.businessName,
    ranchName: workspaceProfile.ranchName,
    ranchManagerName: workspaceProfile.ranchManagerName,
    operationsEmail: workspaceProfile.operationsEmail,
    defaultOwnerName: workspaceProfile.defaultOwnerName,
    defaultOwnerEntity: workspaceProfile.defaultOwnerEntity,
    defaultBarn: workspaceProfile.defaultBarn,
    defaultPasture: workspaceProfile.defaultPasture,
  });
  const previewMode = isStaticPreviewHost();
  const supabaseReady = isSupabaseConfigured();
  const canQuickStart = previewMode || !supabaseReady;

  const accessLabel = useMemo(() => {
    if (!supabaseReady) {
      return 'Browser preview';
    }
    return status === 'signed-in' ? 'Cloud ready' : 'Sign-in pending';
  }, [status, supabaseReady]);

  if (workspaceReady) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);

    const result = initializeWorkspace(form);
    pushToast({
      title: result.ok ? 'Workspace created' : 'Setup blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });

    if (!result.ok) {
      setFormError(result.message);
      setSaving(false);
      return;
    }

    setFormError('');
    setSaving(false);
    navigate('/', { replace: true });
  };

  const handleQuickStart = () => {
    const businessName = form.businessName.trim() || 'My Ranch LLC';
    const ranchName = form.ranchName.trim() || 'Main Ranch';
    const result = initializeWorkspace({
      businessName,
      ranchName,
      ranchManagerName: form.ranchManagerName.trim() || 'Operations Lead',
      operationsEmail: form.operationsEmail.trim() || 'owner@ranch.local',
      defaultOwnerName: form.defaultOwnerName.trim() || ranchName,
      defaultOwnerEntity: form.defaultOwnerEntity.trim() || businessName,
      defaultBarn: form.defaultBarn.trim() || 'Barn 1',
      defaultPasture: form.defaultPasture.trim() || 'Pasture 1',
    });

    pushToast({
      title: result.ok ? 'Workspace ready' : 'Setup blocked',
      message: result.ok ? 'Opening your workspace.' : result.message,
      tone: result.ok ? 'success' : 'error',
    });

    if (result.ok) {
      navigate('/', { replace: true });
    }
  };

  return (
    <main className="premium-setup-shell">
      <div className="premium-auth-grid" aria-hidden="true" />
      <div className="premium-auth-orb premium-auth-orb--one" aria-hidden="true" />
      <div className="premium-auth-orb premium-auth-orb--two" aria-hidden="true" />

      <div className="relative z-[1] mx-auto grid min-h-screen w-full max-w-[1340px] gap-6 px-4 py-5 lg:grid-cols-[0.92fr_1.08fr] lg:px-8 lg:py-8">
        <section className="flex flex-col justify-between rounded-[30px] border border-white/10 bg-white/[0.035] p-6 shadow-[0_34px_100px_rgba(0,0,0,0.34)] backdrop-blur-xl lg:min-h-[calc(100vh-4rem)] lg:p-8">
          <div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="premium-brand-mark premium-brand-mark--mobile">
                  <XbarMark title="XBAR logo" className="h-full w-full" />
                </div>
                <div>
                  <div className="text-[1rem] font-extrabold uppercase tracking-[0.22em] text-white">XBAR</div>
                  <div className="mt-1 text-[0.62rem] font-bold uppercase tracking-[0.3em] text-slate-400">Workspace foundation</div>
                </div>
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[0.66rem] font-bold uppercase tracking-[0.18em] text-slate-300">
                {accessLabel}
              </span>
            </div>

            <div className="mt-14 max-w-[36rem]">
              <h1 className="text-[clamp(2.6rem,7vw,5.25rem)] font-black leading-[0.88] tracking-[-0.08em] text-white">
                Build the ranch workspace around real records.
              </h1>
              <p className="mt-6 text-base leading-8 text-slate-300">
                No fake horses. No invented documents. Start with a clean command center and let the operation become organized from the first entry.
              </p>
            </div>
          </div>

          <div className="mt-10 grid gap-3">
            {foundationSteps.map((step, index) => (
              <div key={step.title} className="rounded-[18px] border border-white/10 bg-black/20 px-5 py-4">
                <div className="flex items-start gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sky-300/20 bg-sky-300/10 text-xs font-extrabold text-sky-100">
                    {index + 1}
                  </span>
                  <div>
                    <div className="text-sm font-extrabold text-white">{step.title}</div>
                    <div className="mt-1 text-sm leading-6 text-slate-400">{step.body}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="premium-setup-card">
          <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-5">
              <div className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-sky-200/80">What unlocks next</div>
              <div className="mt-3 text-2xl font-black tracking-[-0.06em] text-white">Operational clarity in one pass.</div>
              <div className="mt-6 grid gap-3">
                {workspacePreviews.map((item) => (
                  <div key={item.label} className="rounded-[16px] border border-white/10 bg-white/[0.035] px-4 py-3">
                    <div className="text-sm font-extrabold text-white">{item.label}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-400">{item.value}</div>
                  </div>
                ))}
              </div>
              {canQuickStart ? (
                <button className="premium-auth-button premium-auth-button--primary mt-6" type="button" onClick={handleQuickStart}>
                  Quick start preview
                </button>
              ) : null}
            </div>

            <form className="premium-setup-form" onSubmit={handleSubmit}>
              <div>
                <div className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-slate-400">Workspace profile</div>
                <h2 className="mt-2 text-[clamp(2rem,4vw,3.1rem)] font-black leading-[0.95] tracking-[-0.075em] text-white">
                  Set the identity your team will trust.
                </h2>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field-stack">
                  <span className="field-label text-slate-300">Business name</span>
                  <input
                    className="field-input premium-auth-input"
                    value={form.businessName}
                    onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))}
                    placeholder="XBAR LLC"
                  />
                </label>
                <label className="field-stack">
                  <span className="field-label text-slate-300">Ranch name</span>
                  <input
                    className="field-input premium-auth-input"
                    value={form.ranchName}
                    onChange={(event) => setForm((current) => ({ ...current, ranchName: event.target.value }))}
                    placeholder="Primary Ranch"
                  />
                </label>
                <label className="field-stack">
                  <span className="field-label text-slate-300">Ranch manager</span>
                  <input
                    className="field-input premium-auth-input"
                    value={form.ranchManagerName}
                    onChange={(event) => setForm((current) => ({ ...current, ranchManagerName: event.target.value }))}
                    placeholder="Ranch manager"
                  />
                </label>
                <label className="field-stack">
                  <span className="field-label text-slate-300">Ops email</span>
                  <input
                    className="field-input premium-auth-input"
                    type="email"
                    value={form.operationsEmail}
                    onChange={(event) => setForm((current) => ({ ...current, operationsEmail: event.target.value }))}
                    placeholder="ops@xbar.com"
                  />
                </label>
                <label className="field-stack">
                  <span className="field-label text-slate-300">Default owner</span>
                  <input
                    className="field-input premium-auth-input"
                    value={form.defaultOwnerName}
                    onChange={(event) => setForm((current) => ({ ...current, defaultOwnerName: event.target.value }))}
                    placeholder="Legal owner"
                  />
                </label>
                <label className="field-stack">
                  <span className="field-label text-slate-300">Owner entity</span>
                  <input
                    className="field-input premium-auth-input"
                    value={form.defaultOwnerEntity}
                    onChange={(event) => setForm((current) => ({ ...current, defaultOwnerEntity: event.target.value }))}
                    placeholder="Owner entity"
                  />
                </label>
                <label className="field-stack">
                  <span className="field-label text-slate-300">Default barn</span>
                  <input
                    className="field-input premium-auth-input"
                    value={form.defaultBarn}
                    onChange={(event) => setForm((current) => ({ ...current, defaultBarn: event.target.value }))}
                    placeholder="Barn A"
                  />
                </label>
                <label className="field-stack">
                  <span className="field-label text-slate-300">Default pasture</span>
                  <input
                    className="field-input premium-auth-input"
                    value={form.defaultPasture}
                    onChange={(event) => setForm((current) => ({ ...current, defaultPasture: event.target.value }))}
                    placeholder="Pasture 1"
                  />
                </label>
              </div>

              {formError ? <div className="rounded-[16px] border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">{formError}</div> : null}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button className="premium-auth-button premium-auth-button--primary" type="submit" disabled={saving}>
                  {saving ? 'Creating workspace...' : 'Create workspace'}
                </button>
                {canQuickStart ? (
                  <button className="premium-auth-button premium-auth-button--ghost" type="button" onClick={handleQuickStart}>
                    Use clean preview defaults
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

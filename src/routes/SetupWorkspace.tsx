import { type FormEvent, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { isStaticPreviewHost, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useWorkspaceHydrated, useWorkspaceReady, useXbarStore } from '@/store/useXbarStore';
import './cleanEntryExperience.css';

const setupStages = [
  { label: 'Ranch identity', value: 'Business and ranch name' },
  { label: 'Primary contact', value: 'Manager and ops email' },
  { label: 'Ownership defaults', value: 'Owner and entity' },
  { label: 'Home location', value: 'Barn and pasture' },
] as const;

export default function SetupWorkspace() {
  const navigate = useNavigate();
  const workspaceHydrated = useWorkspaceHydrated();
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
    if (!supabaseReady) return 'Browser trial';
    return status === 'signed-in' ? 'Cloud ready' : 'Sign-in pending';
  }, [status, supabaseReady]);

  if (!workspaceHydrated) {
    return <div className="app-loading-shell">Loading ranch workspace...</div>;
  }

  if (workspaceReady) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);

    const result = initializeWorkspace(form);
    pushToast({
      title: result.ok ? 'Ranch created' : 'Setup blocked',
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
      title: result.ok ? 'Ranch ready' : 'Setup blocked',
      message: result.ok ? 'Opening your ranch.' : result.message,
      tone: result.ok ? 'success' : 'error',
    });

    if (result.ok) {
      navigate('/', { replace: true });
    }
  };

  return (
    <main className="clean-entry-shell clean-entry-shell--setup">
      <div className="clean-setup-layout">
        <section className="clean-auth-card clean-auth-card--intro" aria-labelledby="setup-title">
          <div className="clean-brand">
            <span className="clean-brand__mark" aria-hidden="true">
              <XbarMark tone="mono" />
            </span>
            <span>
              <strong>XBAR</strong>
              <small>{accessLabel}</small>
            </span>
          </div>

          <div className="clean-auth-card__header">
            <p>Workspace setup</p>
            <h1 id="setup-title">Configure Workspace</h1>
            <span>Set up your ranch details before adding horses, documents, owners, care, and sale packets.</span>
          </div>

          <ol className="clean-step-list" aria-label="Setup steps">
            {setupStages.map((stage, index) => (
              <li key={stage.label}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{stage.label}</strong>
                <small>{stage.value}</small>
              </li>
            ))}
          </ol>
        </section>

        <section className="clean-auth-card clean-auth-card--wide" aria-label="Create workspace">
          <form className="clean-form clean-setup-form" onSubmit={handleSubmit}>
            <div className="clean-auth-card__header">
              <p>Required first</p>
              <h2>Your ranch details.</h2>
              <span>Everything else can be edited later in Account Settings.</span>
            </div>

            <div className="clean-form-grid">
              <label className="clean-field">
                <span>Business name</span>
                <input value={form.businessName} onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))} placeholder="XBAR LLC" />
              </label>
              <label className="clean-field">
                <span>Ranch name</span>
                <input value={form.ranchName} onChange={(event) => setForm((current) => ({ ...current, ranchName: event.target.value }))} placeholder="Primary Ranch" />
              </label>
              <label className="clean-field">
                <span>Ranch manager</span>
                <input value={form.ranchManagerName} onChange={(event) => setForm((current) => ({ ...current, ranchManagerName: event.target.value }))} placeholder="Ranch manager" />
              </label>
              <label className="clean-field">
                <span>Ops email</span>
                <input type="email" value={form.operationsEmail} onChange={(event) => setForm((current) => ({ ...current, operationsEmail: event.target.value }))} placeholder="ops@xbar.com" />
              </label>
              <label className="clean-field">
                <span>Default owner</span>
                <input value={form.defaultOwnerName} onChange={(event) => setForm((current) => ({ ...current, defaultOwnerName: event.target.value }))} placeholder="Legal owner" />
              </label>
              <label className="clean-field">
                <span>Owner entity</span>
                <input value={form.defaultOwnerEntity} onChange={(event) => setForm((current) => ({ ...current, defaultOwnerEntity: event.target.value }))} placeholder="Owner entity" />
              </label>
              <label className="clean-field">
                <span>Home barn</span>
                <input value={form.defaultBarn} onChange={(event) => setForm((current) => ({ ...current, defaultBarn: event.target.value }))} placeholder="Barn A" />
              </label>
              <label className="clean-field">
                <span>Default pasture</span>
                <input value={form.defaultPasture} onChange={(event) => setForm((current) => ({ ...current, defaultPasture: event.target.value }))} placeholder="Pasture 1" />
              </label>
            </div>

            {formError ? <div className="clean-form-error">{formError}</div> : null}

            <div className="clean-action-stack">
              <button className="clean-primary-button" type="submit" disabled={saving}>
                {saving ? 'Creating workspace...' : 'Create workspace'}
              </button>
              {canQuickStart ? (
                <button className="clean-secondary-button" type="button" onClick={handleQuickStart}>
                  Use preview defaults
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

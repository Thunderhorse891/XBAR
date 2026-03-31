import { type FormEvent, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { isStaticPreviewHost, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useWorkspaceReady, useXbarStore } from '@/store/useXbarStore';

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

  const accessLabel = useMemo(() => {
    if (!isSupabaseConfigured()) {
      return 'Browser setup';
    }
    return status === 'signed-in' ? 'Cloud ready' : 'Sign-in pending';
  }, [status]);

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
    <div className="min-h-screen bg-[#f4f7fb] px-5 py-8">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6">
        <PageHeader
          eyebrow="Workspace setup"
          title="Create your ranch workspace"
          description="Start empty, bring your own records, and build the ledger around real horses."
          showDescription
          actions={<Pill tone={status === 'signed-in' ? 'blue' : 'slate'}>{accessLabel}</Pill>}
        />

        <div className="metric-grid">
          <MetricCard label="Startup" value="Empty" tone="emerald" />
          <MetricCard label="Imports" value="Backup ready" tone="blue" />
          <MetricCard label="Runtime" value={isSupabaseConfigured() ? 'Cloud' : 'Browser'} tone="slate" />
        </div>

        {previewMode ? (
          <Panel eyebrow="Quick start" title="Open the app">
            <div className="inline-actions">
              <button className="button button--primary" type="button" onClick={handleQuickStart}>
                Open workspace
              </button>
            </div>
          </Panel>
        ) : null}

        <div className="dashboard-grid dashboard-grid--primary">
          <Panel eyebrow="Foundation" title="What happens next">
            <div className="stack-list">
              <div className="stack-item">
                <div className="stack-item__title">1. Name the ranch</div>
                <div className="stack-item__copy">Set the business and ranch labels the shell should use.</div>
              </div>
              <div className="stack-item">
                <div className="stack-item__title">2. Set defaults</div>
                <div className="stack-item__copy">Owner, barn, and pasture defaults feed new intake automatically.</div>
              </div>
              <div className="stack-item">
                <div className="stack-item__title">3. Start clean</div>
                <div className="stack-item__copy">No fake horses or documents are loaded into this workspace.</div>
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Workspace profile" title="Details">
            <form className="form-grid" onSubmit={handleSubmit}>
              <label className="field-stack">
                <span className="field-label">Business name</span>
                <input
                  className="field-input"
                  value={form.businessName}
                  onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))}
                  placeholder="XBAR LLC"
                />
              </label>
              <label className="field-stack">
                <span className="field-label">Ranch name</span>
                <input
                  className="field-input"
                  value={form.ranchName}
                  onChange={(event) => setForm((current) => ({ ...current, ranchName: event.target.value }))}
                  placeholder="Primary Ranch"
                />
              </label>
              <label className="field-stack">
                <span className="field-label">Ranch manager</span>
                <input
                  className="field-input"
                  value={form.ranchManagerName}
                  onChange={(event) => setForm((current) => ({ ...current, ranchManagerName: event.target.value }))}
                  placeholder="Ranch manager"
                />
              </label>
              <label className="field-stack">
                <span className="field-label">Ops email</span>
                <input
                  className="field-input"
                  type="email"
                  value={form.operationsEmail}
                  onChange={(event) => setForm((current) => ({ ...current, operationsEmail: event.target.value }))}
                  placeholder="ops@xbar.com"
                />
              </label>
              <label className="field-stack">
                <span className="field-label">Default owner</span>
                <input
                  className="field-input"
                  value={form.defaultOwnerName}
                  onChange={(event) => setForm((current) => ({ ...current, defaultOwnerName: event.target.value }))}
                  placeholder="Legal owner"
                />
              </label>
              <label className="field-stack">
                <span className="field-label">Owner entity</span>
                <input
                  className="field-input"
                  value={form.defaultOwnerEntity}
                  onChange={(event) => setForm((current) => ({ ...current, defaultOwnerEntity: event.target.value }))}
                  placeholder="Owner entity"
                />
              </label>
              <label className="field-stack">
                <span className="field-label">Default barn</span>
                <input
                  className="field-input"
                  value={form.defaultBarn}
                  onChange={(event) => setForm((current) => ({ ...current, defaultBarn: event.target.value }))}
                  placeholder="Barn A"
                />
              </label>
              <label className="field-stack">
                <span className="field-label">Default pasture</span>
                <input
                  className="field-input"
                  value={form.defaultPasture}
                  onChange={(event) => setForm((current) => ({ ...current, defaultPasture: event.target.value }))}
                  placeholder="Pasture 1"
                />
              </label>

              {formError ? <div className="field-error field-error--wide">{formError}</div> : null}

              <div className="inline-actions">
                <button className="button button--primary" type="submit" disabled={saving}>
                  {saving ? 'Creating...' : 'Create workspace'}
                </button>
              </div>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}

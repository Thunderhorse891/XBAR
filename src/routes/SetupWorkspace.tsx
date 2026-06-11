import { type FormEvent, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { isStaticPreviewHost, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useWorkspaceHydrated, useWorkspaceReady, useXbarStore } from '@/store/useXbarStore';
import './authExperience.css';
import './setupExperience.css';
import './setupAssetFallback.css';

const proofTiles = [
  {
    label: 'Horse Profiles',
    summary: 'Clean identity, ownership, media, notes, sale status, and lifetime records start from one trusted ranch layer.',
  },
  {
    label: 'Document Trust',
    summary: 'Coggins, contracts, transfer files, invoices, and proof packets stay tied to the operation they belong to.',
  },
  {
    label: 'Care Cadence',
    summary: 'Vaccines, dental, farrier, foaling windows, blockers, and follow-ups become visible before they turn urgent.',
  },
  {
    label: 'Ranch Clarity',
    summary: 'Barns, pastures, owners, expenses, assets, and team responsibility stay aligned without spreadsheet sprawl.',
  },
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
  const [activeTileIndex, setActiveTileIndex] = useState(0);
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
  const activeTile = proofTiles[activeTileIndex];

  const accessLabel = useMemo(() => {
    if (!supabaseReady) {
      return 'Browser preview';
    }
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
    <main className="premium-setup-shell xbar-login-shell">
      <div className="xbar-login-noise" aria-hidden="true" />
      <div className="premium-setup-frame">
        <section className="premium-setup-brand" aria-labelledby="setup-brand-title">
          <div className="premium-setup-hero" aria-hidden="true" />
          <div className="premium-setup-brand__shade" aria-hidden="true" />

          <div className="premium-setup-brand__top">
            <div className="premium-setup-lockup" aria-label="XBAR">
              <div className="premium-brand-mark premium-brand-mark--setup">
                <XbarMark title="XBAR logo" className="h-full w-full" />
              </div>
              <div>
                <span className="premium-setup-wordmark">XBAR</span>
                <span className="premium-setup-kicker">Command workspace</span>
              </div>
            </div>
            <span className="premium-setup-status">{accessLabel}</span>
          </div>

          <div className="premium-setup-brand__content">
            <p className="premium-setup-eyebrow">Operational foundation</p>
            <h1 id="setup-brand-title" className="premium-setup-brand-title">
              Build your operating workspace
            </h1>
            <p className="premium-setup-brand-copy">
              Start with clean ranch identity, then add horses, records, documents, care, sales, and ownership.
            </p>

            <div className="premium-setup-proof" aria-label="Workspace proof points">
              {proofTiles.map((tile, index) => (
                <button
                  key={tile.label}
                  className="premium-setup-proof-tile"
                  type="button"
                  aria-pressed={index === activeTileIndex}
                  onClick={() => setActiveTileIndex(index)}
                >
                  {tile.label}
                </button>
              ))}
            </div>

            <div className="premium-setup-preview" aria-live="polite">
              <span>{activeTile.label}</span>
              <p>{activeTile.summary}</p>
            </div>
          </div>
        </section>

        <section className="premium-setup-panel" aria-label="Create workspace">
          <form className="premium-setup-card" onSubmit={handleSubmit}>
            <div className="premium-setup-card__header">
              <p className="premium-setup-card-eyebrow">Ranch Profile</p>
              <h2>Set the identity your team will trust.</h2>
              <p>This becomes the default operating layer for records, owners, horses, and documents.</p>
            </div>

            <div className="premium-setup-fields">
              <label className="premium-setup-field">
                <span>Business name</span>
                <input
                  className="premium-auth-input"
                  value={form.businessName}
                  onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))}
                  placeholder="XBAR LLC"
                />
              </label>
              <label className="premium-setup-field">
                <span>Ranch name</span>
                <input
                  className="premium-auth-input"
                  value={form.ranchName}
                  onChange={(event) => setForm((current) => ({ ...current, ranchName: event.target.value }))}
                  placeholder="Primary Ranch"
                />
              </label>
              <label className="premium-setup-field">
                <span>Ranch manager</span>
                <input
                  className="premium-auth-input"
                  value={form.ranchManagerName}
                  onChange={(event) => setForm((current) => ({ ...current, ranchManagerName: event.target.value }))}
                  placeholder="Ranch manager"
                />
              </label>
              <label className="premium-setup-field">
                <span>Ops email</span>
                <input
                  className="premium-auth-input"
                  type="email"
                  value={form.operationsEmail}
                  onChange={(event) => setForm((current) => ({ ...current, operationsEmail: event.target.value }))}
                  placeholder="ops@xbar.com"
                />
              </label>
              <label className="premium-setup-field">
                <span>Default owner</span>
                <input
                  className="premium-auth-input"
                  value={form.defaultOwnerName}
                  onChange={(event) => setForm((current) => ({ ...current, defaultOwnerName: event.target.value }))}
                  placeholder="Legal owner"
                />
              </label>
              <label className="premium-setup-field">
                <span>Owner entity</span>
                <input
                  className="premium-auth-input"
                  value={form.defaultOwnerEntity}
                  onChange={(event) => setForm((current) => ({ ...current, defaultOwnerEntity: event.target.value }))}
                  placeholder="Owner entity"
                />
              </label>
              <label className="premium-setup-field">
                <span>Default barn</span>
                <input
                  className="premium-auth-input"
                  value={form.defaultBarn}
                  onChange={(event) => setForm((current) => ({ ...current, defaultBarn: event.target.value }))}
                  placeholder="Barn A"
                />
              </label>
              <label className="premium-setup-field">
                <span>Default pasture</span>
                <input
                  className="premium-auth-input"
                  value={form.defaultPasture}
                  onChange={(event) => setForm((current) => ({ ...current, defaultPasture: event.target.value }))}
                  placeholder="Pasture 1"
                />
              </label>
            </div>

            {formError ? <div className="premium-setup-error">{formError}</div> : null}

            <div className="premium-setup-actions">
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
        </section>
      </div>
    </main>
  );
}

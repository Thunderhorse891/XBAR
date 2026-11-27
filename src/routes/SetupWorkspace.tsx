import { type FormEvent, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { billingPathForTier } from '@/lib/billingRoutes';
import { applyWorkspaceProfileDefaults } from '@/lib/workspaceSetupDefaults';
import { saveWorkspaceBackupToCloud } from '@/lib/cloudWorkspace';
import { hasMeaningfulWorkspace, serializeWorkspaceBackup } from '@/lib/cloudSyncPolicy';
import { referencedVaultKeys } from '@/lib/localFileVault';
import { readRecordsOwner, rememberRecordsOwner } from '@/lib/recordsOwner';
import { isStaticPreviewHost, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useWorkspaceHydrated, useWorkspaceReady, useXbarStore } from '@/store/useXbarStore';
import './cleanEntryExperience.css';
import { canPresentPurchaseFlow } from '@/lib/nativePlatform';

const setupStages = [
  { label: 'Ranch identity', value: 'Business and ranch name' },
  { label: 'Primary contact', value: 'Manager and ops email' },
  { label: 'Ownership defaults', value: 'Owner and entity' },
  { label: 'Home location', value: 'Barn and pasture' },
] as const;

export default function SetupWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const workspaceHydrated = useWorkspaceHydrated();
  const workspaceReady = useWorkspaceReady();
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const initializeWorkspace = useXbarStore((state) => state.initializeWorkspace);
  const exportWorkspaceBackup = useXbarStore((state) => state.exportWorkspaceBackup);
  const status = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);
  const signOut = useCloudStore((state) => state.signOut);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const cloudWorkspaceReady = useCloudStore((state) => state.workspaceReady);
  const cloudAutosaveReady = useCloudStore((state) => state.autosaveReady);
  const setLastSyncAt = useCloudStore((state) => state.setLastSyncAt);
  const setSyncState = useCloudStore((state) => state.setSyncState);
  const setAutosaveReady = useCloudStore((state) => state.setAutosaveReady);
  const setWorkspaceAccessProfile = useCloudStore((state) => state.setWorkspaceAccessProfile);
  const pushToast = useUiStore((state) => state.pushToast);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [formError, setFormError] = useState('');
  const [cloudSetupBlocked, setCloudSetupBlocked] = useState(false);
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
  const selectedPlan = params.get('plan') ?? '';
  /*
   * A ?plan= parameter sends the customer to billing once setup finishes. In a
   * store build that is a forced arrival at a screen which cannot sell them
   * anything -- the same objection as a button inviting them there, reached
   * without a button. The parameter can still arrive by deep link even though
   * the in-app pricing link is gone, so this is checked rather than assumed
   * unreachable.
   */
  const postSetupPath = useMemo(() => {
    if (selectedPlan && canPresentPurchaseFlow()) return billingPathForTier(selectedPlan);
    // The setup guard can run before cloud hydration restores a configured
    // ranch. Return to that requested screen instead of losing its deep link.
    const from = (location.state as { from?: unknown } | null)?.from;
    if (
      typeof from === 'string' &&
      /^\/(?!\/)/.test(from) &&
      !from.includes('\\') &&
      !Array.from(from).some((character) => character.charCodeAt(0) < 32)
    ) {
      const pathname = from.split(/[?#]/, 1)[0];
      if (pathname !== '/setup' && !pathname.startsWith('/setup/')) return from;
    }
    return '/';
  }, [selectedPlan, location.state]);
  const cloudWorkspaceRequired = supabaseReady && status === 'signed-in' && !workspaceId;
  const cloudLoading = Boolean(
    supabaseReady && session && (!cloudWorkspaceReady || (!cloudAutosaveReady && !cloudSetupBlocked)),
  );

  const accessLabel = useMemo(() => {
    if (!supabaseReady) return 'Browser trial';
    return status === 'signed-in' ? 'Cloud ready' : 'Sign-in pending';
  }, [status, supabaseReady]);

  if (!workspaceHydrated) {
    return <div className="app-loading-shell">Loading ranch workspace...</div>;
  }

  if (workspaceReady && !saving && !cloudSetupBlocked && !cloudWorkspaceRequired) {
    return <Navigate to={postSetupPath} replace />;
  }

  const persistCloudWorkspace = async () => {
    if (!supabaseReady || !session?.user) return { ok: true, message: '' };

    const userId = session.user.id;
    const sourceWorkspaceId = useCloudStore.getState().workspaceId;
    const backup = exportWorkspaceBackup();
    const recordsOwner = readRecordsOwner();
    const hasRecordHistory = Object.entries(backup.workspace).some(
      ([key, value]) =>
        Array.isArray(value) && key !== 'workspaceMembers' && key !== 'roleWorkspaces' && value.length > 0,
    );
    if (
      recordsOwner !== (sourceWorkspaceId || `account:${userId}`) ||
      (!sourceWorkspaceId &&
        (hasRecordHistory ||
          backup.workspace.workspaceMembers?.some((member) => member.source !== 'Owner') ||
          backup.workspace.workspaceMembers?.length > 1)) ||
      referencedVaultKeys(
        backup.workspace.documents,
        backup.workspace.expenseReceipts,
        backup.workspace.salePacketBuilds,
      ).length > 0
    ) {
      return {
        ok: false,
        message:
          'Existing device records need an ownership review in Settings before cloud setup. No records were uploaded.',
      };
    }
    setSyncState('syncing', 'Creating cloud workspace...');
    // A → B → A also retires this save. Same-account token refreshes do not.
    let contextChanged = false;
    const stopWatching = useCloudStore.subscribe((next) => {
      if (next.session?.user.id !== userId || next.workspaceId !== sourceWorkspaceId) contextChanged = true;
    });
    let saved: Awaited<ReturnType<typeof saveWorkspaceBackupToCloud>>;
    try {
      saved = await saveWorkspaceBackupToCloud(backup, {
        expectedContext: { userId, workspaceId: sourceWorkspaceId },
      });
    } catch (error) {
      saved = {
        ok: false,
        message: error instanceof Error ? error.message : 'Unable to create the cloud workspace.',
      };
    } finally {
      stopWatching();
    }

    const current = useCloudStore.getState();
    if (contextChanged || current.session?.user.id !== userId || current.workspaceId !== sourceWorkspaceId) {
      return { ok: false, message: 'Your account or ranch changed while saving setup. Reopen the intended workspace.' };
    }

    if (!saved.ok) {
      setSyncState('error', `${saved.message} Try again before choosing a paid plan.`);
      return saved;
    }

    if (!saved.workspaceId || (sourceWorkspaceId && saved.workspaceId !== sourceWorkspaceId)) {
      return { ok: false, message: 'The saved ranch could not be verified. Open Settings before adding records.' };
    }

    // A first cloud save moves these acknowledged records from the account's
    // pre-workspace namespace. Bind them before publishing the new id so the
    // normal same-ranch reconciliation can align server-owned owner metadata.
    // This is not permission to adopt another ranch's records or local files.
    if (
      !sourceWorkspaceId &&
      saved.workspaceId &&
      readRecordsOwner() === `account:${userId}` &&
      serializeWorkspaceBackup(backup) === serializeWorkspaceBackup(exportWorkspaceBackup()) &&
      referencedVaultKeys(
        backup.workspace.documents,
        backup.workspace.expenseReceipts,
        backup.workspace.salePacketBuilds,
      ).length === 0
    ) {
      rememberRecordsOwner(saved.workspaceId);
    }
    if (readRecordsOwner() !== saved.workspaceId) {
      return {
        ok: false,
        message:
          'Cloud setup was acknowledged, but this device’s records could not be connected safely. Open Settings before adding records.',
      };
    }
    setAutosaveReady(false, false);
    if (saved.workspaceId) setWorkspaceAccessProfile(saved.workspaceId, 'Admin');
    if (saved.updatedAt) setLastSyncAt(saved.updatedAt);
    setSyncState('idle', saved.message);
    return saved;
  };

  const existingSetupBlock = () => {
    const cloud = useCloudStore.getState();
    if (!cloud.session) return '';
    if (!cloud.workspaceReady || (!cloud.autosaveReady && !cloudSetupBlocked))
      return 'Please wait for the initial ranch connection to finish, then retry setup.';
    const owner = readRecordsOwner();
    const expected = cloud.workspaceId || `account:${cloud.session.user.id}`;
    if (owner !== expected && hasMeaningfulWorkspace(exportWorkspaceBackup()))
      return 'This device already contains ranch work. Open Settings to review ownership before creating a cloud ranch.';
    return '';
  };

  const finishSetup = async () => {
    const startedUser = useCloudStore.getState().session?.user.id;
    const cloudSaved = await persistCloudWorkspace();
    if (!cloudSaved.ok) {
      const message = `${cloudSaved.message} Setup is not connected for cloud saving. Existing work remains on this device.${selectedPlan ? ' Your checkout needs the cloud workspace first.' : ''}`;
      setFormError(message);
      if (useCloudStore.getState().session?.user.id === startedUser) setSyncState('error', message);
      pushToast({ title: 'Cloud setup needs attention', message, tone: 'error' });
      setCloudSetupBlocked(true);
      setSaving(false);
      return;
    }
    setFormError('');
    pushToast({
      title: 'Ranch setup saved',
      message: 'Opening your ranch. Cloud saving will finish connecting before record entry.',
      tone: 'success',
    });
    setSaving(false);
    navigate(postSetupPath, { replace: true });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (signingOut || saving) return;
    const blocked = existingSetupBlock();
    if (blocked) {
      setFormError(blocked);
      setCloudSetupBlocked(true);
      return;
    }
    setSaving(true);
    setCloudSetupBlocked(false);

    const result = initializeWorkspace(applyWorkspaceProfileDefaults(form));
    if (!result.ok) {
      pushToast({ title: 'Setup blocked', message: result.message, tone: 'error' });
      setFormError(result.message);
      setSaving(false);
      return;
    }

    if (supabaseReady && session?.user) setAutosaveReady(false, false);
    await finishSetup();
  };

  const handleQuickStart = async () => {
    if (signingOut || saving) return;
    const blocked = existingSetupBlock();
    if (blocked) {
      setFormError(blocked);
      setCloudSetupBlocked(true);
      return;
    }
    setSaving(true);
    setCloudSetupBlocked(false);
    const businessName = form.businessName.trim() || 'My Ranch LLC';
    const ranchName = form.ranchName.trim() || 'Main Ranch';
    /*
     * Quick-start keeps its own invented placeholders, because inventing is the
     * point of it: this path exists so somebody can skip the whole form and get
     * a working ranch. The shared helper deliberately invents nothing, so the
     * form's own submit cannot manufacture a ranch manager or an operations
     * email for a customer who simply left them blank.
     */
    const result = initializeWorkspace(
      applyWorkspaceProfileDefaults({
        ...form,
        businessName,
        ranchName,
        ranchManagerName: form.ranchManagerName.trim() || 'Operations Lead',
        operationsEmail: form.operationsEmail.trim() || 'owner@ranch.local',
        defaultBarn: form.defaultBarn.trim() || 'Barn 1',
        defaultPasture: form.defaultPasture.trim() || 'Pasture 1',
      }),
    );

    if (result.ok) {
      if (supabaseReady && session?.user) setAutosaveReady(false, false);
      await finishSetup();
    } else {
      pushToast({ title: 'Setup blocked', message: result.message, tone: 'error' });
      setFormError(result.message);
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    if (saving || signingOut) return;
    setSigningOut(true);
    setSignOutError('');
    try {
      const result = await signOut();
      if (!result.ok) {
        setSignOutError(result.message);
        return;
      }
      navigate('/login', { replace: true });
    } catch {
      setSignOutError('Could not sign out. Check your connection and try again.');
    } finally {
      setSigningOut(false);
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

          {status === 'signed-in' ? (
            <div className="clean-action-stack">
              <span>Signed in{session?.user.email ? ` as ${session.user.email}` : ''}.</span>
              <button
                className="clean-secondary-button"
                type="button"
                disabled={saving || signingOut}
                onClick={handleSignOut}
              >
                {signingOut ? 'Signing out...' : 'Sign out'}
              </button>
              {signOutError ? (
                <div className="clean-form-error" role="alert">
                  {signOutError}
                </div>
              ) : null}
            </div>
          ) : null}

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
                <input
                  value={form.businessName}
                  onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))}
                  placeholder="XBAR LLC"
                />
              </label>
              <label className="clean-field">
                <span>Ranch name</span>
                <input
                  value={form.ranchName}
                  onChange={(event) => setForm((current) => ({ ...current, ranchName: event.target.value }))}
                  placeholder="Primary Ranch"
                />
              </label>
              <label className="clean-field">
                <span>Ranch manager</span>
                <input
                  value={form.ranchManagerName}
                  onChange={(event) => setForm((current) => ({ ...current, ranchManagerName: event.target.value }))}
                  placeholder="Ranch manager"
                />
              </label>
              <label className="clean-field">
                <span>Ops email</span>
                <input
                  type="email"
                  value={form.operationsEmail}
                  onChange={(event) => setForm((current) => ({ ...current, operationsEmail: event.target.value }))}
                  placeholder="ops@yourranch.com"
                />
              </label>
              <label className="clean-field">
                <span>Default owner</span>
                <input
                  value={form.defaultOwnerName}
                  onChange={(event) => setForm((current) => ({ ...current, defaultOwnerName: event.target.value }))}
                  placeholder="Legal owner"
                />
              </label>
              <label className="clean-field">
                <span>Owner entity</span>
                <input
                  value={form.defaultOwnerEntity}
                  onChange={(event) => setForm((current) => ({ ...current, defaultOwnerEntity: event.target.value }))}
                  placeholder="Owner entity"
                />
              </label>
              <label className="clean-field">
                <span>Home barn</span>
                <input
                  value={form.defaultBarn}
                  onChange={(event) => setForm((current) => ({ ...current, defaultBarn: event.target.value }))}
                  placeholder="Barn A"
                />
              </label>
              <label className="clean-field">
                <span>Default pasture</span>
                <input
                  value={form.defaultPasture}
                  onChange={(event) => setForm((current) => ({ ...current, defaultPasture: event.target.value }))}
                  placeholder="Pasture 1"
                />
              </label>
            </div>

            {formError ? <div className="clean-form-error">{formError}</div> : null}

            <div className="clean-action-stack">
              <button className="clean-primary-button" type="submit" disabled={saving || signingOut || cloudLoading}>
                {saving ? 'Creating workspace...' : cloudLoading ? 'Connecting ranch...' : 'Create workspace'}
              </button>
              {canQuickStart ? (
                <button
                  className="clean-secondary-button"
                  type="button"
                  disabled={saving || signingOut || cloudLoading}
                  onClick={handleQuickStart}
                >
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

import { useEffect, useRef, useState } from 'react';
import { PageHeader, Panel, Pill } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
import { loadWorkspaceBackupFromCloud, saveWorkspaceBackupToCloud } from '@/lib/cloudWorkspace';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { workspaceStorageDriverLabel } from '@/lib/workspaceStorage';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';

export default function Settings() {
  const roleWorkspaces = useXbarStore((state) => state.roleWorkspaces);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const updateWorkspaceProfile = useXbarStore((state) => state.updateWorkspaceProfile);
  const exportWorkspaceBackup = useXbarStore((state) => state.exportWorkspaceBackup);
  const importWorkspaceBackup = useXbarStore((state) => state.importWorkspaceBackup);
  const cloudStatus = useCloudStore((state) => state.status);
  const cloudSession = useCloudStore((state) => state.session);
  const lastCloudSyncAt = useCloudStore((state) => state.lastSyncAt);
  const cloudSyncState = useCloudStore((state) => state.syncState);
  const cloudSyncMessage = useCloudStore((state) => state.syncMessage);
  const setLastCloudSyncAt = useCloudStore((state) => state.setLastSyncAt);
  const sendMagicLink = useCloudStore((state) => state.sendMagicLink);
  const signOutCloud = useCloudStore((state) => state.signOut);
  const pushToast = useUiStore((state) => state.pushToast);
  const importRef = useRef<HTMLInputElement | null>(null);
  const [profileDraft, setProfileDraft] = useState(workspaceProfile);
  const [authEmail, setAuthEmail] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);

  useEffect(() => {
    setProfileDraft(workspaceProfile);
  }, [workspaceProfile]);

  const handleExport = () => {
    try {
      const backup = exportWorkspaceBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `xbar-workspace-${backup.exportedAt.slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      pushToast({
        title: 'Backup exported',
        message: 'Workspace backup downloaded successfully.',
        tone: 'success',
      });
    } catch (error) {
      console.error('Backup export failed', error);
      pushToast({
        title: 'Backup failed',
        message: 'The workspace backup could not be exported.',
        tone: 'error',
      });
    }
  };

  const handleImport = async (file?: File) => {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const result = importWorkspaceBackup(JSON.parse(text));
      pushToast({
        title: result.ok ? 'Backup imported' : 'Import blocked',
        message: result.message,
        tone: result.ok ? 'success' : 'error',
      });
    } catch (error) {
      console.error('Backup import failed', error);
      pushToast({
        title: 'Import failed',
        message: 'Choose a valid XBAR backup JSON file.',
        tone: 'error',
      });
    } finally {
      if (importRef.current) {
        importRef.current.value = '';
      }
    }
  };

  const handleProfileSave = () => {
    if (!profileDraft.ranchName.trim() || !profileDraft.businessName.trim()) {
      pushToast({
        title: 'Profile not saved',
        message: 'Business name and ranch name are required.',
        tone: 'error',
      });
      return;
    }

    const result = updateWorkspaceProfile(profileDraft);
    pushToast({
      title: result.ok ? 'Profile saved' : 'Profile not saved',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
  };

  const handleSendMagicLink = async () => {
    setCloudBusy(true);
    const result = await sendMagicLink(authEmail);
    pushToast({
      title: result.ok ? 'Magic link sent' : 'Sign-in blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setCloudBusy(false);
  };

  const handlePushCloud = async () => {
    setCloudBusy(true);
    const result = await saveWorkspaceBackupToCloud(exportWorkspaceBackup());
    pushToast({
      title: result.ok ? 'Cloud sync complete' : 'Cloud sync failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok && result.updatedAt) {
      setLastCloudSyncAt(result.updatedAt);
    }
    setCloudBusy(false);
  };

  const handlePullCloud = async () => {
    setCloudBusy(true);
    const remote = await loadWorkspaceBackupFromCloud();
    if (!remote.ok) {
      pushToast({
        title: 'Cloud pull failed',
        message: remote.message,
        tone: 'error',
      });
      setCloudBusy(false);
      return;
    }

    const result = importWorkspaceBackup(remote.backup);
    pushToast({
      title: result.ok ? 'Cloud workspace loaded' : 'Cloud import blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok && remote.updatedAt) {
      setLastCloudSyncAt(remote.updatedAt);
    }
    setCloudBusy(false);
  };

  const handleSignOutCloud = async () => {
    setCloudBusy(true);
    const result = await signOutCloud();
    pushToast({
      title: result.ok ? 'Signed out' : 'Sign-out failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setCloudBusy(false);
  };

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="Profile, roles, backups."
      />

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Cloud" title="Auth and workspace sync">
          {isSupabaseConfigured() ? (
            cloudSession ? (
              <>
                <div className="stack-list">
                  <div className="stack-item">
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{cloudSession.user.email ?? 'Signed-in user'}</div>
                        <div className="stack-item__copy">Cloud auth is live for this workspace.</div>
                      </div>
                      <div className="status-inline">
                        <Pill tone="emerald">{cloudStatus === 'signed-in' ? 'Connected' : 'Ready'}</Pill>
                        <Pill tone={cloudSyncState === 'error' ? 'rose' : cloudSyncState === 'syncing' ? 'amber' : 'blue'}>
                          {cloudSyncState === 'syncing' ? 'Syncing' : cloudSyncState === 'error' ? 'Sync issue' : 'Autosave on'}
                        </Pill>
                      </div>
                    </div>
                    <div className="inline-metrics">
                      <span>User ID {cloudSession.user.id.slice(0, 8)}</span>
                      <span>{lastCloudSyncAt ? `Last sync ${formatDateLabel(lastCloudSyncAt)}` : 'No cloud sync yet'}</span>
                      <span>{cloudSyncState === 'syncing' ? 'Saving changes' : cloudSyncState === 'error' ? 'Needs retry' : 'Watching workspace changes'}</span>
                    </div>
                    <div className="detail-block subtle">
                      {cloudSyncMessage || 'Signed-in workspaces autosave after changes and still support manual sync on demand.'}
                    </div>
                  </div>
                </div>
                <div className="inline-actions">
                  <button className="button button--primary button--compact" type="button" onClick={handlePushCloud} disabled={cloudBusy}>
                    {cloudBusy ? 'Working...' : 'Push workspace to cloud'}
                  </button>
                  <button className="button button--ghost button--compact" type="button" onClick={handlePullCloud} disabled={cloudBusy}>
                    Pull cloud workspace
                  </button>
                  <button className="button button--ghost button--compact" type="button" onClick={handleSignOutCloud} disabled={cloudBusy}>
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="form-grid form-grid--tight">
                  <label className="field-stack">
                    <span className="field-label">Email</span>
                    <input className="field-input" type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} />
                  </label>
                </div>
                <div className="detail-block subtle">Magic-link auth enables real cloud sync and storage.</div>
                <div className="inline-actions">
                  <button className="button button--primary button--compact" type="button" onClick={handleSendMagicLink} disabled={cloudBusy || !authEmail.trim()}>
                    {cloudBusy ? 'Sending...' : 'Send magic link'}
                  </button>
                </div>
              </>
            )
          ) : (
            <div className="bullet-list">
              <div className="bullet-list__item">Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to enable cloud auth and sync.</div>
              <div className="bullet-list__item">This keeps the current local-first flow working until cloud credentials are added.</div>
            </div>
          )}
        </Panel>

        <Panel eyebrow="Workspace profile" title="Business and default intake values">
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Business name</span>
              <input className="field-input" value={profileDraft.businessName} onChange={(event) => setProfileDraft((current) => ({ ...current, businessName: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Ranch name</span>
              <input className="field-input" value={profileDraft.ranchName} onChange={(event) => setProfileDraft((current) => ({ ...current, ranchName: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Default owner</span>
              <input className="field-input" value={profileDraft.defaultOwnerName} onChange={(event) => setProfileDraft((current) => ({ ...current, defaultOwnerName: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Default owner entity</span>
              <input className="field-input" value={profileDraft.defaultOwnerEntity} onChange={(event) => setProfileDraft((current) => ({ ...current, defaultOwnerEntity: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Ranch manager</span>
              <input className="field-input" value={profileDraft.ranchManagerName} onChange={(event) => setProfileDraft((current) => ({ ...current, ranchManagerName: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Operations email</span>
              <input className="field-input" type="email" value={profileDraft.operationsEmail} onChange={(event) => setProfileDraft((current) => ({ ...current, operationsEmail: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Default barn</span>
              <input className="field-input" value={profileDraft.defaultBarn} onChange={(event) => setProfileDraft((current) => ({ ...current, defaultBarn: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Default pasture</span>
              <input className="field-input" value={profileDraft.defaultPasture} onChange={(event) => setProfileDraft((current) => ({ ...current, defaultPasture: event.target.value }))} />
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--primary button--compact" type="button" onClick={handleProfileSave}>
              Save workspace profile
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Role matrix" title="Workspace modes">
          <div className="stack-list">
            {roleWorkspaces.map((workspace) => (
              <div key={workspace.role} className="stack-item">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{workspace.role}</div>
                    <div className="stack-item__copy">{workspace.summary}</div>
                  </div>
                  <Pill tone="blue">{workspace.primaryModules.length} modules</Pill>
                </div>
                <div className="token-row">
                  {workspace.permissions.map((permission) => (
                    <Pill key={permission}>{permission}</Pill>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Deployment posture" title="Current runtime">
          <div className="bullet-list">
            <div className="bullet-list__item">This deployment is local-first with IndexedDB persistence.</div>
            <div className="bullet-list__item">Cloud auth, autosave, and remote sync activate when Supabase env is configured.</div>
            <div className="bullet-list__item">Documents are reviewed manually in the current workflow.</div>
            <div className="bullet-list__item">Stripe payment links activate when billing env is configured.</div>
            <div className="bullet-list__item">A full multi-user relational backend is still the next major milestone.</div>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Workspace backup" title="Export and restore data" description="Protect local records.">
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(event) => void handleImport(event.target.files?.[0])}
        />
        <div className="stack-list">
          <div className="stack-item">
            <div className="stack-item__top">
              <div className="stack-item__title">Storage driver</div>
              <Pill tone="blue">{workspaceStorageDriverLabel}</Pill>
            </div>
            <div className="stack-item__copy">Backups are essential until a shared backend is online.</div>
          </div>
        </div>
        <div className="inline-actions">
          <button className="button button--primary button--compact" type="button" onClick={handleExport}>
            Export backup
          </button>
          <button className="button button--ghost button--compact" type="button" onClick={() => importRef.current?.click()}>
            Import backup
          </button>
        </div>
      </Panel>
    </>
  );
}

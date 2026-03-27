import { useEffect, useRef, useState } from 'react';
import { PageHeader, Panel, Pill } from '@/components/app-ui';
import { workspaceStorageDriverLabel } from '@/lib/workspaceStorage';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';

export default function Settings() {
  const roleWorkspaces = useXbarStore((state) => state.roleWorkspaces);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const updateWorkspaceProfile = useXbarStore((state) => state.updateWorkspaceProfile);
  const exportWorkspaceBackup = useXbarStore((state) => state.exportWorkspaceBackup);
  const importWorkspaceBackup = useXbarStore((state) => state.importWorkspaceBackup);
  const pushToast = useUiStore((state) => state.pushToast);
  const importRef = useRef<HTMLInputElement | null>(null);
  const [profileDraft, setProfileDraft] = useState(workspaceProfile);

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

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="Profile, roles, backups."
      />

      <div className="dashboard-grid dashboard-grid--primary">
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
            <div className="bullet-list__item">Shared access works through direct links and saved records.</div>
            <div className="bullet-list__item">Documents are reviewed manually in the current workflow.</div>
            <div className="bullet-list__item">Contracts are tracked here even when billing is handled separately.</div>
            <div className="bullet-list__item">A multi-user backend is still the next major production milestone.</div>
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

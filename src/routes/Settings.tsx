import { useRef } from 'react';
import { PageHeader, Panel, Pill } from '@/components/app-ui';
import { workspaceStorageDriverLabel } from '@/lib/workspaceStorage';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';

export default function Settings() {
  const roleWorkspaces = useXbarStore((state) => state.roleWorkspaces);
  const exportWorkspaceBackup = useXbarStore((state) => state.exportWorkspaceBackup);
  const importWorkspaceBackup = useXbarStore((state) => state.importWorkspaceBackup);
  const pushToast = useUiStore((state) => state.pushToast);
  const importRef = useRef<HTMLInputElement | null>(null);

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

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Roles, backups, and platform status"
        description="Access, backups, status."
      />

      <div className="dashboard-grid dashboard-grid--primary">
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

        <Panel eyebrow="Connection status" title="What is local or not connected">
          <div className="bullet-list">
            <div className="bullet-list__item">This workspace runs locally in the browser.</div>
            <div className="bullet-list__item">Shared links work, but external sign-in is not wired yet.</div>
            <div className="bullet-list__item">Documents are reviewed manually in this build.</div>
            <div className="bullet-list__item">Billing and payments are still handled outside the app.</div>
            <div className="bullet-list__item">A shared backend is not connected yet.</div>
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

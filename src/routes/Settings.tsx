import { PageHeader, Panel, Pill } from '@/components/app-ui';
import { useXbarStore } from '@/store/useXbarStore';

export default function Settings() {
  const roleWorkspaces = useXbarStore((state) => state.roleWorkspaces);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Roles, access, and platform status"
        description="Roles, access, status."
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
    </>
  );
}

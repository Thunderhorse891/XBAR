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
            <div className="bullet-list__item">Google and Facebook auth are not connected yet.</div>
            <div className="bullet-list__item">External OCR is not connected yet.</div>
            <div className="bullet-list__item">External user sessions are still local-only.</div>
            <div className="bullet-list__item">Subscription tiers and limits are in the product, but billing is not connected yet.</div>
            <div className="bullet-list__item">This preview is browser-local. It is not a shared backend yet.</div>
          </div>
        </Panel>
      </div>
    </>
  );
}

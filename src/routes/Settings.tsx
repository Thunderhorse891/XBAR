import { PageHeader, Panel, Pill } from '@/components/app-ui';
import { useXbarStore } from '@/store/useXbarStore';

export default function Settings() {
  const roleWorkspaces = useXbarStore((state) => state.roleWorkspaces);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Roles, access, and platform posture"
        description="This page makes the role-aware foundation explicit so the product can evolve into true admin, manager, owner, medical, and sales workspaces."
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

        <Panel eyebrow="Foundations" title="What is intentionally scaffolded">
          <div className="bullet-list">
            <div className="bullet-list__item">Google and Facebook auth are modeled but not falsely presented as live.</div>
            <div className="bullet-list__item">OCR queue, review, and extracted entities are structured before provider wiring.</div>
            <div className="bullet-list__item">Owner portal, buyer watchlists, and branded sale packets already have product surfaces.</div>
            <div className="bullet-list__item">Subscription tiers and feature gates now exist as first-class architecture.</div>
          </div>
        </Panel>
      </div>
    </>
  );
}

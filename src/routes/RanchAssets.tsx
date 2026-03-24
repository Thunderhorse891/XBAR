import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { useXbarStore } from '@/store/useXbarStore';

export default function RanchAssets() {
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const assigned = ranchAssets.filter((asset) => asset.status === 'Assigned');
  const serviceSoon = ranchAssets.filter((asset) => asset.condition !== 'Excellent');

  return (
    <>
      <PageHeader
        eyebrow="Ranch assets"
        title="Ranch assets and kits"
        description="This foundation gives tack, tools, kits, and equipment their own operating lane so the ranch is managed like a real business platform, not just a horse list."
      />

      <div className="metric-grid">
        <MetricCard label="Tracked assets" value={`${ranchAssets.length}`} detail="Tack, equipment, medical kits, and supply stock" />
        <MetricCard label="Assigned" value={`${assigned.length}`} detail="Assets currently tied to a horse, barn, or workflow" tone="blue" />
        <MetricCard label="Service soon" value={`${serviceSoon.length}`} detail="Items already drifting toward maintenance or refill work" tone="amber" />
        <MetricCard label="Availability" value={`${ranchAssets.length - assigned.length}`} detail="Assets ready for reassignment" tone="emerald" />
      </div>

      <Panel eyebrow="Inventory" title="Operational asset register">
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Category</th>
                <th>Status</th>
                <th>Condition</th>
                <th>Assigned to</th>
                <th>Next service</th>
              </tr>
            </thead>
            <tbody>
              {ranchAssets.map((asset) => (
                <tr key={asset.id}>
                  <td>{asset.name}</td>
                  <td>{asset.category}</td>
                  <td>{asset.status}</td>
                  <td>
                    <Pill tone={asset.condition === 'Attention Required' ? 'rose' : asset.condition === 'Service Soon' ? 'amber' : 'emerald'}>
                      {asset.condition}
                    </Pill>
                  </td>
                  <td>{asset.assignedTo}</td>
                  <td>{asset.nextService}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

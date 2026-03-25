import { useState } from 'react';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { useXbarStore } from '@/store/useXbarStore';
import type { AssetCondition, AssetStatus } from '@/types/xbar';

const statuses: AssetStatus[] = ['Available', 'Assigned', 'In Service'];
const conditions: AssetCondition[] = ['Excellent', 'Service Soon', 'Attention Required'];

export default function RanchAssets() {
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const updateAsset = useXbarStore((state) => state.updateAsset);
  const assigned = ranchAssets.filter((asset) => asset.status === 'Assigned');
  const serviceSoon = ranchAssets.filter((asset) => asset.condition !== 'Excellent');
  const [selectedAssetId, setSelectedAssetId] = useState(ranchAssets[0]?.id ?? '');
  const [message, setMessage] = useState('');

  const selectedAsset = ranchAssets.find((asset) => asset.id === selectedAssetId) ?? ranchAssets[0];
  const [form, setForm] = useState({
    status: selectedAsset?.status ?? 'Available',
    condition: selectedAsset?.condition ?? 'Excellent',
    assignedTo: selectedAsset?.assignedTo ?? '',
    location: selectedAsset?.location ?? '',
    nextService: selectedAsset?.nextService ?? '',
    notes: selectedAsset?.notes ?? '',
  });

  const handleAssetSelection = (assetId: string) => {
    setSelectedAssetId(assetId);
    const asset = ranchAssets.find((item) => item.id === assetId);
    if (asset) {
      setForm({
        status: asset.status,
        condition: asset.condition,
        assignedTo: asset.assignedTo,
        location: asset.location,
        nextService: asset.nextService,
        notes: asset.notes,
      });
    }
  };

  const handleSave = () => {
    const result = updateAsset(selectedAssetId, form);
    setMessage(result.message);
  };

  return (
    <>
      <PageHeader
        eyebrow="Ranch assets"
        title="Ranch assets and kits"
        description="This module now behaves like a real operational register for tack, tools, kits, and equipment instead of a decorative table."
      />

      {message ? <div className="status-banner">{message}</div> : null}

      <div className="metric-grid">
        <MetricCard label="Tracked assets" value={`${ranchAssets.length}`} detail="Tack, equipment, medical kits, and supply stock" />
        <MetricCard label="Assigned" value={`${assigned.length}`} detail="Assets currently tied to a horse, barn, or workflow" tone="blue" />
        <MetricCard label="Service soon" value={`${serviceSoon.length}`} detail="Items already drifting toward maintenance or refill work" tone="amber" />
        <MetricCard label="Availability" value={`${ranchAssets.length - assigned.length}`} detail="Assets ready for reassignment" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
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
                  <tr key={asset.id} onClick={() => handleAssetSelection(asset.id)} className={asset.id === selectedAssetId ? 'table-row--selected' : ''}>
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

        <Panel eyebrow="Toolkit ops" title="Update assignment and maintenance">
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Asset</span>
              <select className="field-input" value={selectedAssetId} onChange={(event) => handleAssetSelection(event.target.value)}>
                {ranchAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Status</span>
              <select className="field-input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as AssetStatus }))}>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Condition</span>
              <select className="field-input" value={form.condition} onChange={(event) => setForm((current) => ({ ...current, condition: event.target.value as AssetCondition }))}>
                {conditions.map((condition) => (
                  <option key={condition} value={condition}>
                    {condition}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Assigned to</span>
              <input className="field-input" value={form.assignedTo} onChange={(event) => setForm((current) => ({ ...current, assignedTo: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Location</span>
              <input className="field-input" value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Next service</span>
              <input className="field-input" type="date" value={form.nextService} onChange={(event) => setForm((current) => ({ ...current, nextService: event.target.value }))} />
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Notes</span>
              <textarea className="field-textarea" rows={4} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--primary button--compact" type="button" onClick={handleSave}>
              Save asset changes
            </button>
          </div>
        </Panel>
      </div>
    </>
  );
}

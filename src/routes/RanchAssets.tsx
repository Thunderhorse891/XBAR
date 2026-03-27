import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { AssetCondition, AssetStatus } from '@/types/xbar';

const statuses: AssetStatus[] = ['Available', 'Assigned', 'In Service'];
const conditions: AssetCondition[] = ['Excellent', 'Service Soon', 'Attention Required'];

export default function RanchAssets() {
  const navigate = useNavigate();
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const updateAsset = useXbarStore((state) => state.updateAsset);
  const pushToast = useUiStore((state) => state.pushToast);
  const canManageAssets = useCurrentRoleCapability('manageAssets');
  const assigned = ranchAssets.filter((asset) => asset.status === 'Assigned');
  const serviceSoon = ranchAssets.filter((asset) => asset.condition !== 'Excellent');
  const [selectedAssetId, setSelectedAssetId] = useState(ranchAssets[0]?.id ?? '');
  const [menuState, setMenuState] = useState<{ assetId: string; x: number; y: number } | null>(null);

  const selectedAsset = ranchAssets.find((asset) => asset.id === selectedAssetId) ?? ranchAssets[0];
  const menuAsset = ranchAssets.find((asset) => asset.id === menuState?.assetId);
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
    pushToast({
      title: result.ok ? 'Asset updated' : 'Asset update blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
  };

  const menuItems = menuAsset
    ? [
        {
          id: 'select-asset',
          label: 'Select asset',
          onSelect: () => handleAssetSelection(menuAsset.id),
        },
        ...(canManageAssets
          ? [
              {
                id: 'mark-available',
                label: 'Mark available',
                onSelect: () => {
                  const result = updateAsset(menuAsset.id, { status: 'Available' });
                  pushToast({
                    title: result.ok ? 'Asset updated' : 'Asset update blocked',
                    message: result.message,
                    tone: result.ok ? 'success' : 'error',
                  });
                },
              },
            ]
          : []),
        ...(menuAsset.category === 'Medical Kit'
          ? [
              {
                id: 'open-medical',
                label: 'Open medical workspace',
                onSelect: () => navigate('/medical'),
              },
            ]
          : []),
      ]
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Ranch toolkit"
        title="Ranch Toolkit"
      />

      <div className="metric-grid">
        <MetricCard label="Tracked assets" value={`${ranchAssets.length}`} detail="Tack, kits, stock" />
        <MetricCard label="Assigned" value={`${assigned.length}`} detail="Tied to active work" tone="blue" />
        <MetricCard label="Service soon" value={`${serviceSoon.length}`} detail="Needs maintenance or refill" tone="amber" />
        <MetricCard label="Availability" value={`${ranchAssets.length - assigned.length}`} detail="Assets ready for reassignment" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Inventory" title="Register">
          {ranchAssets.length ? (
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
                    <tr
                      key={asset.id}
                      onClick={() => handleAssetSelection(asset.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        handleAssetSelection(asset.id);
                        setMenuState({ assetId: asset.id, x: event.clientX, y: event.clientY });
                      }}
                      className={`${asset.id === selectedAssetId ? 'table-row--selected ' : ''}table-row--interactive`.trim()}
                    >
                      <td>{asset.name}</td>
                      <td>{asset.category}</td>
                      <td>{asset.status}</td>
                      <td>
                        <Pill tone={asset.condition === 'Attention Required' ? 'rose' : asset.condition === 'Service Soon' ? 'amber' : 'emerald'}>
                          {asset.condition}
                        </Pill>
                      </td>
                      <td>{asset.assignedTo}</td>
                      <td>{formatDateLabel(asset.nextService)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState compact title="No assets tracked" description="Add gear to start the register." />
          )}
        </Panel>

        <Panel eyebrow="Toolkit ops" title="Update assignment and maintenance" description="Fast edits.">
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Asset</span>
              <select className="field-input" value={selectedAssetId} onChange={(event) => handleAssetSelection(event.target.value)} disabled={!canManageAssets}>
                {ranchAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Status</span>
              <select className="field-input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as AssetStatus }))} disabled={!canManageAssets}>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Condition</span>
              <select className="field-input" value={form.condition} onChange={(event) => setForm((current) => ({ ...current, condition: event.target.value as AssetCondition }))} disabled={!canManageAssets}>
                {conditions.map((condition) => (
                  <option key={condition} value={condition}>
                    {condition}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Assigned to</span>
              <input className="field-input" value={form.assignedTo} onChange={(event) => setForm((current) => ({ ...current, assignedTo: event.target.value }))} disabled={!canManageAssets} />
            </label>
            <label className="field-stack">
              <span className="field-label">Location</span>
              <input className="field-input" value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} disabled={!canManageAssets} />
            </label>
            <label className="field-stack">
              <span className="field-label">Next service</span>
              <input className="field-input" type="date" value={form.nextService} onChange={(event) => setForm((current) => ({ ...current, nextService: event.target.value }))} disabled={!canManageAssets} />
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Notes</span>
              <textarea className="field-textarea" rows={4} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} disabled={!canManageAssets} />
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--primary button--compact" type="button" onClick={handleSave} disabled={!canManageAssets}>
              Save asset changes
            </button>
          </div>
        </Panel>
      </div>

      <ContextMenu open={Boolean(menuAsset)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}

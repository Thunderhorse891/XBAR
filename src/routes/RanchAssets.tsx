import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { AssetCategory, AssetCondition, AssetStatus } from '@/types/xbar';

const statuses: AssetStatus[] = ['Available', 'Assigned', 'In Service'];
const conditions: AssetCondition[] = ['Excellent', 'Service Soon', 'Attention Required'];
const assetCategories: AssetCategory[] = ['Tack', 'Equipment', 'Medical Kit', 'Feed & Supply', 'Transport'];

export default function RanchAssets() {
  const navigate = useNavigate();
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const addRanchAsset = useXbarStore((state) => state.addRanchAsset);
  const updateAsset = useXbarStore((state) => state.updateAsset);
  const pushToast = useUiStore((state) => state.pushToast);
  const canManageAssets = useCurrentRoleCapability('manageAssets');
  const assigned = ranchAssets.filter((asset) => asset.status === 'Assigned');
  const serviceSoon = ranchAssets.filter((asset) => asset.condition !== 'Excellent');
  const [selectedAssetId, setSelectedAssetId] = useState(ranchAssets[0]?.id ?? '');
  const [assetQuery, setAssetQuery] = useState('');
  const [newAsset, setNewAsset] = useState({ name: '', category: 'Equipment' as AssetCategory, location: '' });
  const [newAssetError, setNewAssetError] = useState('');
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
      <div className="surface-hero surface-hero--dark">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Ranch Operations</span>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat">
              <span>Assets</span>
              <strong>{ranchAssets.length}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Assigned</span>
              <strong>{assigned.length}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Service soon</span>
              <strong style={{ color: serviceSoon.length ? 'var(--amber)' : 'var(--emerald)' }}>{serviceSoon.length}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Available</span>
              <strong style={{ color: 'var(--emerald)' }}>{ranchAssets.length - assigned.length}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Tracked assets" value={`${ranchAssets.length}`} detail="Tack, kits, stock" />
        <MetricCard label="Assigned" value={`${assigned.length}`} detail="Tied to active work" tone="blue" />
        <MetricCard label="Service soon" value={`${serviceSoon.length}`} detail="Needs maintenance or refill" tone="amber" />
        <MetricCard label="Availability" value={`${ranchAssets.length - assigned.length}`} detail="Assets ready for reassignment" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Inventory" title="Register">
          {ranchAssets.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <input
                className="field-input"
                placeholder="Search by name, category, or assignment…"
                value={assetQuery}
                onChange={(e) => setAssetQuery(e.target.value)}
                style={{ maxWidth: '380px' }}
              />
            </div>
          )}
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
                  {ranchAssets.filter((a) => !assetQuery.trim() || a.name.toLowerCase().includes(assetQuery.toLowerCase()) || a.category.toLowerCase().includes(assetQuery.toLowerCase()) || a.assignedTo.toLowerCase().includes(assetQuery.toLowerCase())).map((asset) => (
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

      <Panel eyebrow="Add to inventory" title="New asset">
        <div className="form-grid form-grid--tight">
          <label className="field-stack field-stack--wide">
            <span className="field-label">Asset name</span>
            <input className="field-input" value={newAsset.name} onChange={(e) => { setNewAsset((f) => ({ ...f, name: e.target.value })); setNewAssetError(''); }} placeholder="e.g. Western Saddle #3" disabled={!canManageAssets} />
          </label>
          <label className="field-stack">
            <span className="field-label">Category</span>
            <select className="field-input" value={newAsset.category} onChange={(e) => setNewAsset((f) => ({ ...f, category: e.target.value as AssetCategory }))} disabled={!canManageAssets}>
              {assetCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </label>
          <label className="field-stack">
            <span className="field-label">Location</span>
            <input className="field-input" value={newAsset.location} onChange={(e) => setNewAsset((f) => ({ ...f, location: e.target.value }))} placeholder="e.g. Tack room" disabled={!canManageAssets} />
          </label>
        </div>
        {newAssetError ? <div className="field-error">{newAssetError}</div> : null}
        <div className="inline-actions">
          <button
            className="button button--primary button--compact"
            type="button"
            disabled={!canManageAssets}
            onClick={() => {
              if (!newAsset.name.trim()) { setNewAssetError('Asset name is required.'); return; }
              const result = addRanchAsset(newAsset);
              pushToast({ title: result.ok ? 'Asset added' : 'Add blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
              if (result.ok) {
                setNewAsset({ name: '', category: 'Equipment', location: '' });
                setNewAssetError('');
                if (result.id) setSelectedAssetId(result.id);
              }
            }}
          >
            Add asset
          </button>
        </div>
      </Panel>

      <ContextMenu open={Boolean(menuAsset)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}

import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ASSET_CATEGORIES } from '@/lib/recordOptions';
import { Plus, Wrench } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { AssetCondition } from '@/types/xbar';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const CONDITION_TONE: Record<AssetCondition, Tone> = {
  Excellent: 'success',
  'Service Soon': 'warning',
  'Attention Required': 'danger',
};

export default function Equipment() {
  const pushToast = useUiStore((s) => s.pushToast);
  const allAssets = useXbarStore((s) => s.ranchAssets);
  const openQuickCreate = useUiStore((s) => s.openQuickCreate);
  const canManage = useCurrentRoleCapability('manageAssets');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const category = ASSET_CATEGORIES.find((item) => item === params.get('category')) ?? 'Equipment';
  const assets = useMemo(() => allAssets.filter((asset) => asset.category === category), [allAssets, category]);
  const updateAsset = useXbarStore((s) => s.updateAsset);

  const markRepaired = (assetId: string, name: string, location: string) => {
    const result = updateAsset(assetId, { condition: 'Excellent', status: 'Available', location });
    pushToast({
      title: result.ok ? 'Equipment updated' : 'Update blocked',
      message: result.ok ? `${name} marked repaired — condition set to Excellent` : result.message,
      tone: result.ok ? 'success' : 'error',
    });
  };

  const counts = useMemo(
    () => ({
      serviceSoon: assets.filter((e) => e.condition === 'Service Soon').length,
      attention: assets.filter((e) => e.condition === 'Attention Required').length,
      good: assets.filter((e) => e.condition === 'Excellent').length,
    }),
    [assets],
  );

  const addEquipment = () => openQuickCreate({ action: 'Add Equipment' });

  return (
    <>
      <PageHead
        eyebrow="Records"
        title="Equipment & Maintenance"
        subtitle="Trucks, trailers, tractors, gates, troughs, and tools — status, service, and open work orders."
        actions={
          <>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={addEquipment} disabled={!canManage}>
              Add Equipment
            </ActionButton>
          </>
        }
      />

      <label className="field-stack" style={{ marginBottom: 16 }}>
        <span className="field-label">Asset category</span>
        <select
          className="field-input"
          value={category}
          onChange={(event) => {
            const next = new URLSearchParams(params);
            next.set('category', event.target.value);
            setParams(next);
          }}
        >
          {ASSET_CATEGORIES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      {assets.length === 0 ? (
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon">
              <Wrench size={26} />
            </span>
            <div className="xs-empty__title">No {category.toLowerCase()} tracked yet</div>
            <div className="xs-empty__sub">
              Add trailers, trucks, tractors, tack, and tools to track condition, service schedules, and work orders.
            </div>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={addEquipment} disabled={!canManage}>
              Add equipment
            </ActionButton>
          </div>
        </Card>
      ) : (
        <>
          <div className="xs-grid-3">
            <Card>
              <div className="xs-card__sub">Service soon</div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: counts.serviceSoon ? 'var(--xbar-warning)' : 'var(--xbar-text)',
                }}
              >
                {counts.serviceSoon}
              </div>
            </Card>
            <Card>
              <div className="xs-card__sub">Attention required</div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: counts.attention ? 'var(--xbar-danger)' : 'var(--xbar-text)',
                }}
              >
                {counts.attention}
              </div>
            </Card>
            <Card>
              <div className="xs-card__sub">Good condition</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-success)' }}>{counts.good}</div>
            </Card>
          </div>

          <div className="xs-grid-2">
            {assets.map((e) => (
              <Card key={e.id}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{e.name}</div>
                    <div className="xs-card__sub">
                      {e.category} · {e.location}
                    </div>
                    <div className="xs-mrow__detail" style={{ marginTop: 6 }}>
                      {e.notes || `${e.status}${e.nextService ? ` · next service ${e.nextService}` : ''}`}
                    </div>
                  </div>
                  <StatusChip tone={CONDITION_TONE[e.condition]}>{e.condition}</StatusChip>
                </div>
                <div className="xs-toolbar" style={{ marginTop: 12 }}>
                  <ActionButton size="sm" onClick={() => navigate(`/assets?asset=${encodeURIComponent(e.id)}`)}>
                    Open details
                  </ActionButton>
                  {canManage && e.condition !== 'Excellent' ? (
                    <ActionButton size="sm" onClick={() => markRepaired(e.id, e.name, e.location)}>
                      Mark Repaired
                    </ActionButton>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}

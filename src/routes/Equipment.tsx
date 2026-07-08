import { useMemo } from 'react';
import { Plus, Wrench } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import type { AssetCondition, RanchAsset } from '@/types/xbar';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const CONDITION_TONE: Record<AssetCondition, Tone> = {
  Excellent: 'success',
  'Service Soon': 'warning',
  'Attention Required': 'danger',
};

export default function Equipment() {
  const pushToast = useUiStore((s) => s.pushToast);
  const assets = useXbarStore((s) => s.ranchAssets);
  const addRanchAsset = useXbarStore((s) => s.addRanchAsset);
  const updateAsset = useXbarStore((s) => s.updateAsset);
  const toast = (m: string) => pushToast({ title: 'Equipment', message: m, tone: 'success' });

  const openWorkOrder = (asset: RanchAsset) => {
    const result = updateAsset(asset.id, {
      status: 'In Service',
      condition: 'Service Soon',
      notes: `Work order opened ${new Date().toISOString().slice(0, 10)}`,
    });
    toast(result.ok ? `${asset.name} pulled into service — work order open` : result.message);
  };

  const logRepair = (asset: RanchAsset) => {
    const result = updateAsset(asset.id, {
      status: 'Available',
      condition: 'Excellent',
      notes: `Repair completed ${new Date().toISOString().slice(0, 10)}`,
    });
    toast(result.ok ? `${asset.name} repaired and back in rotation` : result.message);
  };

  const counts = useMemo(
    () => ({
      serviceSoon: assets.filter((e) => e.condition === 'Service Soon').length,
      attention: assets.filter((e) => e.condition === 'Attention Required').length,
      good: assets.filter((e) => e.condition === 'Excellent').length,
    }),
    [assets],
  );

  const addEquipment = () => {
    const result = addRanchAsset({ name: 'New equipment', category: 'Equipment', location: 'Main Barn' });
    toast(result.ok ? 'Equipment added — open it to add details' : result.message);
  };

  return (
    <>
      <PageHead
        eyebrow="Records"
        title="Equipment & Maintenance"
        subtitle="Trucks, trailers, tractors, gates, troughs, and tools — status, service, and open work orders."
        actions={
          <ActionButton variant="primary" icon={<Plus size={15} />} onClick={addEquipment}>
            Add Equipment
          </ActionButton>
        }
      />

      {assets.length === 0 ? (
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon">
              <Wrench size={26} />
            </span>
            <div className="xs-empty__title">No equipment tracked yet</div>
            <div className="xs-empty__sub">
              Add trailers, trucks, tractors, tack, and tools to track condition, service schedules, and work orders.
            </div>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={addEquipment}>
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
                  <ActionButton size="sm" icon={<Wrench size={14} />} onClick={() => openWorkOrder(e)}>
                    Open Work Order
                  </ActionButton>
                  <ActionButton size="sm" onClick={() => logRepair(e)}>
                    Log Repair
                  </ActionButton>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}

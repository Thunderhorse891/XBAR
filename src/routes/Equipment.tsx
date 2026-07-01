import { Plus, Wrench } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { equipmentList } from '@/data/xbarSaasMock';

export default function Equipment() {
  const pushToast = useUiStore((s) => s.pushToast);
  const toast = (m: string) => pushToast({ title: 'Equipment', message: m, tone: 'success' });

  return (
    <>
      <PageHead
        eyebrow="Records"
        title="Equipment & Maintenance"
        subtitle="Trucks, trailers, tractors, gates, troughs, and tools — status, service, and open work orders."
        actions={
          <>
            <ActionButton icon={<Wrench size={15} />} onClick={() => toast('Work order created')}>Create Work Order</ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => toast('Equipment added')}>Add Equipment</ActionButton>
          </>
        }
      />

      <div className="xs-grid-3">
        <Card><div className="xs-card__sub">Service due</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-warning)' }}>{equipmentList.filter((e) => e.status === 'Service due' || e.status === 'Check').length}</div></Card>
        <Card><div className="xs-card__sub">Broken</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-danger)' }}>{equipmentList.filter((e) => e.status === 'Broken').length}</div></Card>
        <Card><div className="xs-card__sub">Operational</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-success)' }}>{equipmentList.filter((e) => e.status === 'OK').length}</div></Card>
      </div>

      <div className="xs-grid-2">
        {equipmentList.map((e) => (
          <Card key={e.id}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{e.name}</div>
                <div className="xs-card__sub">{e.type} · {e.location}</div>
                <div className="xs-mrow__detail" style={{ marginTop: 6 }}>{e.detail}</div>
              </div>
              <StatusChip tone={e.tone}>{e.status}</StatusChip>
            </div>
            <div className="xs-toolbar" style={{ marginTop: 12 }}>
              <ActionButton size="sm" onClick={() => toast(`Work order — ${e.name}`)}>Work Order</ActionButton>
              <ActionButton size="sm" onClick={() => toast(`Repair logged — ${e.name}`)}>Log Repair</ActionButton>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

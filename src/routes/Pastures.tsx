import { AlertTriangle, MapPin, Move } from 'lucide-react';
import { useUiStore } from '@/store/useUiStore';
import { ActionButton, Card, PageHead } from '@/components/saas';
import { pastures } from '@/data/xbarSaasMock';

const tag = (label: string, state: 'OK' | 'Check' | 'Issue' | string) =>
  <span className={`xs-ptag xs-ptag--${state === 'OK' ? 'ok' : state === 'Issue' ? 'issue' : 'check'}`}>{label} {state}</span>;

export default function Pastures() {
  const pushToast = useUiStore((state) => state.pushToast);
  const toast = (m: string) => pushToast({ title: 'Pastures', message: m, tone: 'success' });

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Pastures & Locations"
        subtitle="Where every animal is, what needs attention, and which locations have open issues."
        actions={
          <>
            <ActionButton icon={<Move size={15} />} onClick={() => toast('Move animals drawer opened')}>Move Animals</ActionButton>
            <ActionButton variant="primary" icon={<AlertTriangle size={15} />} onClick={() => toast('Pasture issue reported')}>Report Issue</ActionButton>
          </>
        }
      />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--xbar-text-muted)', fontSize: 13 }}>
          <MapPin size={16} /> Map view is integration-ready. Location cards below reflect current placement.
        </div>
        <div
          style={{
            marginTop: 14, height: 150, borderRadius: 'var(--xbar-radius)', border: '1px dashed var(--xbar-border-strong)',
            background: 'repeating-linear-gradient(135deg, var(--xbar-surface-warm), var(--xbar-surface-warm) 18px, rgba(216,195,165,0.25) 18px, rgba(216,195,165,0.25) 36px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--xbar-text-muted)', fontSize: 13,
          }}
        >
          Ranch map — Coming Soon
        </div>
      </Card>

      <div className="xs-grid-2">
        {pastures.map((p) => (
          <Card key={p.id}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <h2 className="xs-card__title" style={{ fontSize: 18 }}>{p.name}</h2>
                <div className="xs-card__sub">{p.animals} animals · {p.openTasks} open tasks · {p.rainfall}</div>
              </div>
            </div>
            <div className="xs-pcard__tags" style={{ marginTop: 12 }}>
              {tag('Water', p.water)}
              {tag('Fence', p.fence)}
              <span className="xs-ptag xs-ptag--check">{p.grazing} graze</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <ActionButton size="sm" onClick={() => toast(`Task added for ${p.name}`)}>Add Task</ActionButton>
              <ActionButton size="sm" onClick={() => toast(`Issue reported for ${p.name}`)}>Report Issue</ActionButton>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

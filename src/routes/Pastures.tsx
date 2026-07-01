import { useState } from 'react';
import { AlertTriangle, Camera, MapPin, Move } from 'lucide-react';
import { useUiStore } from '@/store/useUiStore';
import { ActionButton, Card, PageHead, SlideOverDrawer, StatusChip } from '@/components/saas';
import { pastures, type Pasture } from '@/data/xbarSaasMock';

const tagClass = (s: string) => `xs-ptag xs-ptag--${s === 'OK' ? 'ok' : s === 'Issue' ? 'issue' : 'check'}`;
const tone = (s: string) => (s === 'OK' ? 'success' : s === 'Issue' ? 'danger' : 'warning') as 'success' | 'danger' | 'warning';

export default function Pastures() {
  const pushToast = useUiStore((state) => state.pushToast);
  const [selected, setSelected] = useState<Pasture | null>(null);
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
          <MapPin size={16} /> Map view is integration-ready. Click a location to open its record.
        </div>
        <div
          style={{
            marginTop: 14, height: 140, borderRadius: 'var(--xbar-radius)', border: '1px dashed var(--xbar-border-strong)',
            background: 'repeating-linear-gradient(135deg, var(--xbar-surface-warm), var(--xbar-surface-warm) 18px, var(--xbar-surface-cool) 18px, var(--xbar-surface-cool) 36px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--xbar-text-muted)', fontSize: 13,
          }}
        >
          Ranch map — Coming Soon
        </div>
      </Card>

      <div className="xs-grid-2">
        {pastures.map((p) => (
          <button key={p.id} type="button" className="xs-card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setSelected(p)}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <h2 className="xs-card__title" style={{ fontSize: 17 }}>{p.name}</h2>
                <div className="xs-card__sub">{p.animals} animals · {p.openTasks} open tasks · {p.rainfall}</div>
              </div>
            </div>
            <div className="xs-pcard__tags" style={{ marginTop: 12 }}>
              <span className={tagClass(p.water)}>Water {p.water}</span>
              <span className={tagClass(p.fence)}>Fence {p.fence}</span>
              <span className="xs-ptag xs-ptag--check">{p.grazing} graze</span>
            </div>
          </button>
        ))}
      </div>

      <SlideOverDrawer
        open={Boolean(selected)}
        title={selected?.name ?? ''}
        subtitle={selected ? `${selected.animals} animals · ${selected.openTasks} open tasks` : ''}
        onClose={() => setSelected(null)}
        footer={selected ? (<><ActionButton icon={<Move size={15} />} onClick={() => { toast(`Move from ${selected.name}`); }}>Move Animals</ActionButton><ActionButton variant="primary" icon={<AlertTriangle size={15} />} onClick={() => { toast(`Issue reported at ${selected.name}`); setSelected(null); }}>Report Issue</ActionButton></>) : null}
      >
        {selected ? (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatusChip tone={tone(selected.water)}>Water {selected.water}</StatusChip>
              <StatusChip tone={tone(selected.fence)}>Fence {selected.fence}</StatusChip>
            </div>

            <div className="xs-section-label">Animals currently here</div>
            <dl className="xs-kv">
              <dt>Count</dt><dd>{selected.animals}</dd>
              <dt>Grazing pressure</dt><dd>{selected.grazing}</dd>
              <dt>Rainfall (7d)</dt><dd>{selected.rainfall}</dd>
            </dl>

            <div className="xs-section-label">Recent moves</div>
            <div className="xs-tl">
              <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">3 mares moved in</div><div className="xs-tl__time">Yesterday · from Main Barn</div></span></div>
              <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">1 gelding moved out</div><div className="xs-tl__time">3 days ago · to Quarantine</div></span></div>
            </div>

            <div className="xs-section-label">Open tasks</div>
            <div className="xs-mlist">
              <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Check water trough</span><span className="xs-mrow__detail">Due today</span></span><StatusChip tone="warning">Open</StatusChip></div>
            </div>

            <div className="xs-section-label">Photos</div>
            <button type="button" className="xs-drop" onClick={() => toast('Photo upload coming soon')}><Camera size={18} style={{ display: 'block', margin: '0 auto 6px' }} />Add a location photo</button>
          </>
        ) : null}
      </SlideOverDrawer>
    </>
  );
}

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useXbarStore } from '@/store/useXbarStore';
import type { HorseRecord, HorseSegment } from '@/types/xbar';

type Group = { id: HorseSegment; name: HorseSegment; location: string; count: number; needsCare: number };

function commonLocation(horses: HorseRecord[]): string {
  const tally = new Map<string, number>();
  horses.forEach((h) => {
    const loc = h.location.barn || h.location.pasture || h.location.ranch;
    if (loc) tally.set(loc, (tally.get(loc) ?? 0) + 1);
  });
  let best = '—';
  let max = 0;
  tally.forEach((n, loc) => { if (n > max) { max = n; best = loc; } });
  return best;
}

export default function HerdGroups() {
  const navigate = useNavigate();
  const horses = useXbarStore((s) => s.horses);

  const groups = useMemo<Group[]>(() => {
    const bySegment = new Map<HorseSegment, HorseRecord[]>();
    horses.forEach((h) => {
      const list = bySegment.get(h.segment) ?? [];
      list.push(h);
      bySegment.set(h.segment, list);
    });
    return Array.from(bySegment.entries()).map(([segment, list]) => ({
      id: segment,
      name: segment,
      location: commonLocation(list),
      count: list.length,
      needsCare: list.filter((h) => h.status === 'Medical Review').length,
    }));
  }, [horses]);

  if (horses.length === 0) {
    return (
      <>
        <PageHead
          eyebrow="Ranch"
          title="Herd Groups"
          subtitle="Your horses grouped by what they're for — sale prospects, broodmares, studs, young stock, and more."
          actions={<ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add Horse</ActionButton>}
        />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon"><Users size={26} /></span>
            <div className="xs-empty__title">No groups yet</div>
            <div className="xs-empty__sub">Add horses and XBAR groups them automatically — sale prospects, broodmares, studs, and young stock.</div>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add first horse</ActionButton>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Ranch"
        title="Herd Groups"
        subtitle="Your horses grouped by what they're for — sale prospects, broodmares, studs, young stock, and more."
        actions={<ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add Horse</ActionButton>}
      />

      <div className="xs-grid-3">
        {groups.map((g) => (
          <Card key={g.id}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <h2 className="xs-card__title" style={{ fontSize: 18 }}>{g.name}</h2>
                <div className="xs-card__sub">{g.location}</div>
              </div>
              <StatusChip tone={g.needsCare ? 'warning' : 'neutral'}>{g.needsCare ? `${g.needsCare} need care` : 'OK'}</StatusChip>
            </div>
            <div className="xs-statgrid" style={{ marginTop: 14 }}>
              <div className="xs-stattile"><div className="xs-stattile__num">{g.count}</div><div className="xs-stattile__label">Horses</div></div>
              <div className="xs-stattile"><div className={`xs-stattile__num${g.needsCare ? ' xs-stattile__num--warning' : ''}`}>{g.needsCare}</div><div className="xs-stattile__label">Need care</div></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <ActionButton size="sm" onClick={() => navigate('/horses')}>Open Group</ActionButton>
              <ActionButton size="sm" onClick={() => navigate('/today')}>Care Tasks</ActionButton>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

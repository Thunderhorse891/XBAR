import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { HorsesIcon } from '@/components/icons';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useXbarStore } from '@/store/useXbarStore';
import type { HorseRecord, HorseStatus } from '@/types/xbar';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const STATUS_TONE: Record<HorseStatus, Tone> = {
  'In Training': 'info',
  'Broodmare Program': 'neutral',
  'Sale Prep': 'info',
  'Medical Review': 'danger',
  Pasture: 'neutral',
  Retired: 'neutral',
};

function locationLabel(h: HorseRecord): string {
  return [h.location.barn, h.location.pasture].filter(Boolean).join(' · ') || h.location.ranch || '—';
}

export default function Animals() {
  const navigate = useNavigate();
  const horses = useXbarStore((s) => s.horses);
  const [group, setGroup] = useState<string>('All');
  const [q, setQ] = useState('');

  const groups = useMemo(() => ['All', ...Array.from(new Set(horses.map((h) => h.segment)))], [horses]);

  const rows = useMemo(
    () =>
      horses.filter(
        (h) =>
          (group === 'All' || h.segment === group) &&
          (h.name.toLowerCase().includes(q.toLowerCase()) || h.barnName.toLowerCase().includes(q.toLowerCase())),
      ),
    [horses, group, q],
  );

  if (horses.length === 0) {
    return (
      <>
        <PageHead
          eyebrow="Ranch"
          title="Horses"
          subtitle="All your horses in one place — who they are, where they live, care status, and whether they're ready to sell."
          actions={<ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add Horse</ActionButton>}
        />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon"><HorsesIcon width={26} height={26} /></span>
            <div className="xs-empty__title">No horses yet</div>
            <div className="xs-empty__sub">Add your first horse to start tracking care, paperwork, and ownership history.</div>
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
        title="Horses"
        subtitle="All your horses in one place — who they are, where they live, care status, and whether they're ready to sell."
        actions={<ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add Horse</ActionButton>}
      />

      <div className="xs-stickybar">
        <div className="xs-fchips">
          {groups.map((g) => (
            <button key={g} type="button" className={`xs-fchip${group === g ? ' xs-fchip--active' : ''}`} onClick={() => setGroup(g)}>{g}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <label className="xs-search" style={{ maxWidth: 260 }}>
          <Search size={15} className="xs-search__icon" />
          <input className="xs-search__input" placeholder="Search horses" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      <div className="xs-tablewrap">
        <table className="xs-table">
          <thead>
            <tr><th>Horse</th><th>Segment</th><th>Location</th><th>Owner</th><th>Status</th><th>Readiness</th></tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const readiness = h.readiness?.score ?? 0;
              return (
                <tr key={h.id} onClick={() => navigate(`/animals/${h.id}`)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="xs-mdrow__avatar"><HorsesIcon width={18} height={18} /></span>
                      <span><div style={{ fontWeight: 600 }}>{h.name}</div><div className="xs-mdrow__meta">{h.sex} · {h.age} yrs</div></span>
                    </div>
                  </td>
                  <td className="xs-muted">{h.segment}</td>
                  <td>{locationLabel(h)}</td>
                  <td className="xs-muted">{h.owner}</td>
                  <td><StatusChip tone={STATUS_TONE[h.status] ?? 'neutral'}>{h.status}</StatusChip></td>
                  <td>
                    {readiness > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="xs-finbar__track" style={{ width: 70 }}><span className="xs-finbar__fill" style={{ width: `${readiness}%`, background: readiness >= 95 ? 'var(--xbar-success)' : readiness >= 75 ? 'var(--xbar-warning)' : 'var(--xbar-danger)' }} /></span>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{readiness}%</span>
                      </div>
                    ) : <span className="xs-muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <Card><div className="xs-empty">No horses match this filter.</div></Card> : null}
    </>
  );
}

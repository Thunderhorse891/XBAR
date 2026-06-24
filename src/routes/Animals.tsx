import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { HorsesIcon } from '@/components/icons';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { animalGroups, rosterAnimals } from '@/data/xbarSaasMock';

export default function Animals() {
  const navigate = useNavigate();
  const [group, setGroup] = useState<string>('All');
  const [q, setQ] = useState('');

  const rows = useMemo(() => rosterAnimals.filter((a) => (group === 'All' || a.group === group) && a.name.toLowerCase().includes(q.toLowerCase())), [group, q]);

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Animals"
        subtitle="Every animal on the operation — identity, location, care status, and sale readiness in one roster."
        actions={<ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add Animal</ActionButton>}
      />

      <div className="xs-stickybar">
        <div className="xs-fchips">
          {animalGroups.map((g) => (
            <button key={g} type="button" className={`xs-fchip${group === g ? ' xs-fchip--active' : ''}`} onClick={() => setGroup(g)}>{g}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <label className="xs-search" style={{ maxWidth: 260 }}>
          <Search size={15} className="xs-search__icon" />
          <input className="xs-search__input" placeholder="Search animals" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      <div className="xs-tablewrap">
        <table className="xs-table">
          <thead>
            <tr><th>Animal</th><th>Type</th><th>Location</th><th>Group</th><th>Status</th><th>Readiness</th></tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} onClick={() => navigate(`/animals/${a.id}`)}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="xs-mdrow__avatar"><HorsesIcon width={18} height={18} /></span>
                    <span><div style={{ fontWeight: 600 }}>{a.name}</div><div className="xs-mdrow__meta">{a.sex} · {a.age}</div></span>
                  </div>
                </td>
                <td className="xs-muted">{a.species}</td>
                <td>{a.location}</td>
                <td className="xs-muted">{a.group}</td>
                <td><StatusChip tone={a.tone}>{a.status}</StatusChip></td>
                <td>
                  {a.readiness > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="xs-finbar__track" style={{ width: 70 }}><span className="xs-finbar__fill" style={{ width: `${a.readiness}%`, background: a.readiness >= 95 ? 'var(--xbar-success)' : a.readiness >= 75 ? 'var(--xbar-warning)' : 'var(--xbar-danger)' }} /></span>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{a.readiness}%</span>
                    </div>
                  ) : <span className="xs-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <Card><div className="xs-empty">No animals match this filter.</div></Card> : null}
    </>
  );
}

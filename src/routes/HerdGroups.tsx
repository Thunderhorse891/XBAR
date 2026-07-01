import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { herdGroups } from '@/data/xbarSaasMock';

export default function HerdGroups() {
  const navigate = useNavigate();
  const smart = herdGroups.filter((g) => g.smart);
  const manual = herdGroups.filter((g) => !g.smart);

  const groupCard = (g: (typeof herdGroups)[number]) => (
    <Card key={g.id}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <h2 className="xs-card__title" style={{ fontSize: 18 }}>{g.name}</h2>
          <div className="xs-card__sub">{g.location}</div>
        </div>
        {g.smart ? <StatusChip tone="brass">Smart</StatusChip> : <StatusChip tone="neutral">Manual</StatusChip>}
      </div>
      <div className="xs-statgrid" style={{ marginTop: 14 }}>
        <div className="xs-stattile"><div className="xs-stattile__num">{g.count}</div><div className="xs-stattile__label">Animals</div></div>
        <div className="xs-stattile"><div className="xs-stattile__num xs-stattile__num--warning">{g.openTasks}</div><div className="xs-stattile__label">Open tasks</div></div>
      </div>
      <div className="xs-mrow" style={{ borderBottom: 0, paddingLeft: 0 }}>
        <span className="xs-mrow__main"><span className="xs-mrow__detail">Next</span><span className="xs-mrow__title">{g.nextEvent}</span></span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <ActionButton size="sm" onClick={() => navigate('/horses')}>Open Group</ActionButton>
        <ActionButton size="sm" onClick={() => navigate('/today')}>Add Task</ActionButton>
      </div>
    </Card>
  );

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Herd Groups"
        subtitle="Organize animals into smart and manual groups for movement, care, and sale readiness."
        actions={<ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses')}>New Group</ActionButton>}
      />

      <div className="xs-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Sparkles size={13} /> Smart groups</div>
      <div className="xs-grid-3">{smart.map(groupCard)}</div>

      <div className="xs-eyebrow">Manual groups</div>
      <div className="xs-grid-3">{manual.map(groupCard)}</div>
    </>
  );
}

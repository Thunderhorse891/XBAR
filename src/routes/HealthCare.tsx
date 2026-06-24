import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Plus } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { healthRecords } from '@/data/xbarSaasMock';

const FILTERS = ['All', 'Blocker', 'Due', 'Expiring', 'Current'] as const;

export default function HealthCare() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const [f, setF] = useState<string>('All');
  const rows = useMemo(() => (f === 'All' ? healthRecords : healthRecords.filter((r) => r.status === f)), [f]);
  const toast = (m: string) => pushToast({ title: 'Health & Care', message: m, tone: 'success' });

  return (
    <>
      <PageHead
        eyebrow="Care"
        title="Health & Compliance"
        subtitle="Vaccines, Coggins, certificates, farrier, dental, and medications — records that gate care and release."
        actions={
          <>
            <ActionButton icon={<CalendarPlus size={15} />} onClick={() => toast('Care scheduled')}>Schedule Care</ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => toast('Health record added')}>Add Record</ActionButton>
          </>
        }
      />

      <div className="xs-grid-3">
        <Card><div className="xs-card__sub">Overdue care</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-danger)' }}>3</div></Card>
        <Card><div className="xs-card__sub">Expiring documents</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-warning)' }}>15</div></Card>
        <Card><div className="xs-card__sub">Medical holds</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-danger)' }}>1</div></Card>
      </div>

      <div className="xs-fchips">
        {FILTERS.map((x) => <button key={x} type="button" className={`xs-fchip${f === x ? ' xs-fchip--active' : ''}`} onClick={() => setF(x)}>{x}</button>)}
      </div>

      <div className="xs-tablewrap">
        <table className="xs-table">
          <thead><tr><th>Animal</th><th>Record</th><th>Date</th><th>Detail</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => navigate('/animals')}>
                <td style={{ fontWeight: 600 }}>{r.animal}</td>
                <td>{r.type}</td>
                <td className="xs-muted">{r.date}</td>
                <td className="xs-muted">{r.detail}</td>
                <td><StatusChip tone={r.tone}>{r.status}</StatusChip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Plus } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { breedingRecords } from '@/data/xbarSaasMock';

export default function BreedingFoaling() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const toast = (m: string) => pushToast({ title: 'Breeding & Foaling', message: m, tone: 'success' });

  return (
    <>
      <PageHead
        eyebrow="Care"
        title="Breeding & Foaling"
        subtitle="Cover dates, preg checks, foaling windows, and registration — tracked from pairing to foal record."
        actions={
          <>
            <ActionButton icon={<CalendarPlus size={15} />} onClick={() => toast('Preg check scheduled')}>Schedule Preg Check</ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => toast('Breeding record added')}>Add Record</ActionButton>
          </>
        }
      />

      <div className="xs-grid-3">
        <Card><div className="xs-card__sub">Mares in program</div><div style={{ fontSize: 28, fontWeight: 700 }}>{breedingRecords.length}</div></Card>
        <Card><div className="xs-card__sub">Preg checks due</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-warning)' }}>1</div></Card>
        <Card><div className="xs-card__sub">Confirmed in foal</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-success)' }}>{breedingRecords.filter((b) => b.stage.includes('foal')).length}</div></Card>
      </div>

      <div className="xs-tablewrap">
        <table className="xs-table">
          <thead><tr><th>Mare</th><th>Stud</th><th>Method</th><th>Stage</th><th>Due</th><th /></tr></thead>
          <tbody>
            {breedingRecords.map((b) => (
              <tr key={b.id} onClick={() => navigate('/animals')}>
                <td style={{ fontWeight: 600 }}>{b.mare}</td>
                <td>{b.stud}</td>
                <td className="xs-muted">{b.method}</td>
                <td><StatusChip tone={b.tone}>{b.stage}</StatusChip></td>
                <td className="xs-muted">{b.due}</td>
                <td onClick={(e) => e.stopPropagation()}><ActionButton size="sm" onClick={() => toast(`Foal record — ${b.mare}`)}>Foal Record</ActionButton></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

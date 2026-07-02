import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Plus, Sprout } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';

export default function BreedingFoaling() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const horses = useXbarStore((s) => s.horses);
  const toast = (m: string) => pushToast({ title: 'Breeding & Foaling', message: m, tone: 'success' });

  const mares = useMemo(
    () => horses.filter((h) => h.segment === 'Broodmare' || (h.sex === 'Mare' && h.breedingTimeline.length > 0)),
    [horses],
  );

  const rows = useMemo(
    () => mares.map((m) => {
      // Newest event first (addBreedingEvent prepends) reflects current status.
      const latest = m.breedingTimeline[0];
      const statusText = latest ? `${latest.status ?? ''} ${latest.title ?? ''}`.toLowerCase() : '';
      // Only a confirmed, still-active pregnancy counts as in foal — exclude
      // foaling outcomes and open/negative checks (both contain "foal").
      const inFoal =
        /(in foal|confirmed|pregnan|positive)/.test(statusText) &&
        !/(not in foal|open|foaled|lost|slipped|negative|weaned)/.test(statusText);
      return { id: m.id, mare: m.name, stage: latest?.status ?? latest?.title ?? 'No records', due: latest?.date ?? '—', inFoal, hasRecords: m.breedingTimeline.length > 0 };
    }),
    [mares],
  );

  const confirmedInFoal = rows.filter((r) => r.inFoal).length;

  if (mares.length === 0) {
    return (
      <>
        <PageHead
          eyebrow="Care"
          title="Breeding & Foaling"
          subtitle="Cover dates, preg checks, foaling windows, and registration — tracked from pairing to foal."
          actions={<ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add Broodmare</ActionButton>}
        />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon"><Sprout size={26} /></span>
            <div className="xs-empty__title">No broodmares yet</div>
            <div className="xs-empty__sub">Add a broodmare to track cover dates, preg checks, foaling windows, and foal registration.</div>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add broodmare</ActionButton>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Care"
        title="Breeding & Foaling"
        subtitle="Cover dates, preg checks, foaling windows, and registration — tracked from pairing to foal."
        actions={
          <>
            <ActionButton icon={<CalendarPlus size={15} />} onClick={() => toast('Preg check scheduled')}>Schedule Preg Check</ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add Broodmare</ActionButton>
          </>
        }
      />

      <div className="xs-grid-3">
        <Card><div className="xs-card__sub">Broodmares</div><div style={{ fontSize: 28, fontWeight: 700 }}>{mares.length}</div></Card>
        <Card><div className="xs-card__sub">With breeding records</div><div style={{ fontSize: 28, fontWeight: 700 }}>{rows.filter((r) => r.hasRecords).length}</div></Card>
        <Card><div className="xs-card__sub">In foal</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-success)' }}>{confirmedInFoal}</div></Card>
      </div>

      <div className="xs-tablewrap">
        <table className="xs-table">
          <thead><tr><th>Mare</th><th>Latest record</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => navigate(`/animals/${r.id}`)}>
                <td style={{ fontWeight: 600 }}>{r.mare}</td>
                <td className="xs-muted">{r.stage}</td>
                <td className="xs-muted">{r.due}</td>
                <td><StatusChip tone={r.inFoal ? 'success' : r.hasRecords ? 'info' : 'neutral'}>{r.inFoal ? 'In foal' : r.hasRecords ? 'In program' : 'No records'}</StatusChip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

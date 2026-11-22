import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarPlus, Plus, Sprout } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { buildMareBreedingState, chronologicalBreedingEvents } from '@/lib/breedingIntelligence';
import { useDayKey } from '@/hooks/useDayKey';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';

export default function BreedingFoaling() {
  const navigate = useNavigate();
  const openQuickCreate = useUiStore((s) => s.openQuickCreate);
  const horses = useXbarStore((s) => s.horses);

  const mares = useMemo(
    () => horses.filter((h) => h.segment === 'Broodmare' || (h.sex === 'Mare' && h.breedingTimeline.length > 0)),
    [horses],
  );

  const dayKey = useDayKey();
  const rows = useMemo(
    () =>
      mares.map((m) => {
        // Only dated, occurred evidence can describe the current breeding state.
        const latest = chronologicalBreedingEvents(m.breedingTimeline)[0];
        // In foal is decided where the Breeding screen decides it: the recorded
        // result of the latest non-pending check (audit F07). This page used to
        // keep its own word match over the latest title, so "Pregnancy check"
        // read as in foal whatever the result said.
        const state = buildMareBreedingState(m);
        const inFoal = state.status === 'in-foal' || state.status === 'near-term';
        return {
          id: m.id,
          mare: m.name,
          stage: latest?.title ?? 'No occurred records',
          due: latest?.date ?? '—',
          inFoal,
          statusLabel: state.statusLabel,
          hasRecords: m.breedingTimeline.length > 0,
        };
      }),
    // Re-evaluate due dates when the local day changes, even without new records.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mares, dayKey],
  );

  const confirmedInFoal = rows.filter((r) => r.inFoal).length;

  if (mares.length === 0) {
    return (
      <>
        <PageHead
          eyebrow="Care"
          title="Breeding & Foaling"
          subtitle="Cover dates, preg checks, foaling windows, and registration — tracked from pairing to foal."
          actions={
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>
              Add Broodmare
            </ActionButton>
          }
        />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon">
              <Sprout size={26} />
            </span>
            <div className="xs-empty__title">No broodmares yet</div>
            <div className="xs-empty__sub">
              Add a broodmare to track cover dates, preg checks, foaling windows, and foal registration.
            </div>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>
              Add broodmare
            </ActionButton>
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
            <ActionButton onClick={() => navigate('/breeding')}>Open breeding records</ActionButton>
            <ActionButton
              icon={<CalendarPlus size={15} />}
              onClick={() => openQuickCreate({ action: 'Add Breeding Record' })}
            >
              Add Breeding Record
            </ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>
              Add Broodmare
            </ActionButton>
          </>
        }
      />

      <div className="xs-grid-3">
        <Card>
          <div className="xs-card__sub">Broodmares</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{mares.length}</div>
        </Card>
        <Card>
          <div className="xs-card__sub">With breeding records</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{rows.filter((r) => r.hasRecords).length}</div>
        </Card>
        <Card>
          <div className="xs-card__sub">In foal</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-success)' }}>{confirmedInFoal}</div>
        </Card>
      </div>

      <div className="xs-tablewrap">
        <table className="xs-table">
          <thead>
            <tr>
              <th>Mare</th>
              <th>Latest record</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>
                  <Link to={`/horses/${r.id}`}>{r.mare}</Link>
                </td>
                <td className="xs-muted">{r.stage}</td>
                <td className="xs-muted">{r.due}</td>
                <td>
                  <StatusChip tone={r.inFoal ? 'success' : r.hasRecords ? 'info' : 'neutral'}>
                    {r.statusLabel}
                  </StatusChip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

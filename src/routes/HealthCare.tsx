import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, HeartPulse, Plus } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { buildCareBoardRows } from '@/lib/dashboardOps';
import type { CareSignalStatus } from '@/lib/dashboardOps';

const FILTERS = ['All', 'Due', 'Watch', 'Clear'] as const;

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const STATUS_TONE: Record<CareSignalStatus, Tone> = { due: 'danger', watch: 'warning', clear: 'success' };
const STATUS_LABEL: Record<CareSignalStatus, string> = { due: 'Due', watch: 'Watch', clear: 'Current' };

export default function HealthCare() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const horses = useXbarStore((s) => s.horses);
  const documents = useXbarStore((s) => s.documents);
  const expenseReceipts = useXbarStore((s) => s.expenseReceipts);
  const [f, setF] = useState<string>('All');
  const toast = (m: string) => pushToast({ title: 'Health & Care', message: m, tone: 'success' });

  const careRows = useMemo(
    () => buildCareBoardRows(horses, documents, expenseReceipts),
    [horses, documents, expenseReceipts],
  );

  const rows = useMemo(() => {
    const matches = (status: CareSignalStatus) =>
      f === 'All' ||
      (f === 'Due' && status === 'due') ||
      (f === 'Watch' && status === 'watch') ||
      (f === 'Clear' && status === 'clear');
    // buildCareBoardRows only returns horses with a due/watch signal, so add the
    // fully-current horses back in under All/Clear — this page shows care status,
    // not just exceptions.
    const issueIds = new Set(careRows.map((r) => r.horseId));
    const signalRows = careRows.flatMap((row) =>
      row.signals
        .filter((sig) => matches(sig.status))
        .map((sig) => ({
          id: `${row.horseId}-${sig.key}`,
          horseId: row.horseId,
          animal: row.horseName,
          type: sig.label,
          detail: sig.detail,
          dueDate: sig.dueDate,
          status: sig.status,
        })),
    );
    const clearRows =
      f === 'All' || f === 'Clear'
        ? horses
            .filter((h) => !issueIds.has(h.id))
            .map((h) => ({
              id: `${h.id}-current`,
              horseId: h.id,
              animal: h.name,
              type: 'Coggins · Wormer · Dental',
              detail: 'All current',
              dueDate: undefined as string | undefined,
              status: 'clear' as CareSignalStatus,
            }))
        : [];
    return [...signalRows, ...clearRows];
  }, [careRows, horses, f]);

  const dueCount = careRows.reduce((n, r) => n + r.signals.filter((s) => s.status === 'due').length, 0);
  const watchCount = careRows.reduce((n, r) => n + r.signals.filter((s) => s.status === 'watch').length, 0);
  const medicalHolds = horses.filter((h) => h.status === 'Medical Review').length;

  if (horses.length === 0) {
    return (
      <>
        <PageHead
          eyebrow="Care"
          title="Health & Care"
          subtitle="Vaccines, Coggins, farrier, dental, and medications — everything that keeps a horse healthy and sale-ready."
          actions={
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>
              Add Horse
            </ActionButton>
          }
        />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon">
              <HeartPulse size={26} />
            </span>
            <div className="xs-empty__title">No care records yet</div>
            <div className="xs-empty__sub">
              Add horses and their health records — XBAR tracks Coggins, wormer, dental, and vaccine due dates and flags
              what's holding up a sale.
            </div>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>
              Add first horse
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
        title="Health & Care"
        subtitle="Vaccines, Coggins, farrier, dental, and medications — everything that keeps a horse healthy and sale-ready."
        actions={
          <>
            <ActionButton icon={<CalendarPlus size={15} />} onClick={() => toast('Care scheduled')}>
              Schedule Care
            </ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => toast('Health record added')}>
              Add Record
            </ActionButton>
          </>
        }
      />

      <div className="xs-grid-3">
        <Card>
          <div className="xs-card__sub">Care due</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: dueCount ? 'var(--xbar-danger)' : 'var(--xbar-text)' }}>
            {dueCount}
          </div>
        </Card>
        <Card>
          <div className="xs-card__sub">Watch</div>
          <div
            style={{ fontSize: 28, fontWeight: 700, color: watchCount ? 'var(--xbar-warning)' : 'var(--xbar-text)' }}
          >
            {watchCount}
          </div>
        </Card>
        <Card>
          <div className="xs-card__sub">Medical holds</div>
          <div
            style={{ fontSize: 28, fontWeight: 700, color: medicalHolds ? 'var(--xbar-danger)' : 'var(--xbar-text)' }}
          >
            {medicalHolds}
          </div>
        </Card>
      </div>

      <div className="xs-fchips">
        {FILTERS.map((x) => (
          <button
            key={x}
            type="button"
            className={`xs-fchip${f === x ? ' xs-fchip--active' : ''}`}
            onClick={() => setF(x)}
          >
            {x}
          </button>
        ))}
      </div>

      <div className="xs-tablewrap">
        <table className="xs-table">
          <thead>
            <tr>
              <th>Animal</th>
              <th>Record</th>
              <th>Due</th>
              <th>Detail</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => navigate(`/horses/${r.horseId}`)}>
                <td style={{ fontWeight: 600 }}>{r.animal}</td>
                <td>{r.type}</td>
                <td className="xs-muted">{r.dueDate ?? '—'}</td>
                <td className="xs-muted">{r.detail}</td>
                <td>
                  <StatusChip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusChip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <Card>
          <div className="xs-empty">No care items match this filter.</div>
        </Card>
      ) : null}
    </>
  );
}

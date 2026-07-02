import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, List, Plus } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useXbarStore } from '@/store/useXbarStore';
import type { HorseRecord, SalesLead } from '@/types/xbar';

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

const STAGES: { id: string; label: SalesLead['stage'] }[] = [
  { id: 'new', label: 'New' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'offer', label: 'Offer' },
  { id: 'closed', label: 'Closed' },
];

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const STAGE_TONE: Record<SalesLead['stage'], Tone> = { New: 'neutral', Qualified: 'info', Offer: 'warning', Closed: 'success' };

export default function SalesPipeline() {
  const navigate = useNavigate();
  const leads = useXbarStore((s) => s.salesLeads);
  const horses = useXbarStore((s) => s.horses);
  const [view, setView] = useState<'board' | 'list'>('board');

  const horseMap = useMemo(() => new Map(horses.map((h) => [h.id, h])), [horses]);
  const targetFor = (l: SalesLead) => (horseMap.get(l.horseId) as HorseRecord | undefined)?.sale?.askPrice ?? 0;
  const horseNameFor = (l: SalesLead) => horseMap.get(l.horseId)?.name ?? 'Unlinked animal';

  const openValue = leads.filter((l) => l.stage !== 'Closed').reduce((s, l) => s + (l.offerAmount ?? targetFor(l)), 0);
  const activeCount = leads.filter((l) => l.stage !== 'Closed').length;
  const closedCount = leads.filter((l) => l.stage === 'Closed').length;

  return (
    <>
      <PageHead
        eyebrow="Selling"
        title="Sales"
        subtitle={leads.length ? `${activeCount} active deals · ${usd(openValue)} open value across the operation.` : 'Track buyers from first inquiry to closed sale.'}
        actions={
          <>
            <div className="xs-toggle" role="tablist" aria-label="View">
              <button type="button" className={`xs-toggle__btn${view === 'board' ? ' xs-toggle__btn--active' : ''}`} onClick={() => setView('board')}><LayoutGrid size={14} /> Board</button>
              <button type="button" className={`xs-toggle__btn${view === 'list' ? ' xs-toggle__btn--active' : ''}`} onClick={() => setView('list')}><List size={14} /> List</button>
            </div>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/sale-packet-studio')}>New Deal</ActionButton>
          </>
        }
      />

      {view === 'board' ? (
        <div className="xs-kanban">
          {STAGES.map((col) => {
            const deals = leads.filter((l) => l.stage === col.label);
            return (
              <div key={col.id} className="xs-kcol">
                <div className="xs-kcol__head">
                  <span className="xs-kcol__name">{col.label}</span>
                  <span className="xs-kcol__count">{deals.length}</span>
                </div>
                <div className="xs-kcol__drop">
                  {deals.length === 0 ? <div className="xs-kcol__empty">—</div> : deals.map((d) => (
                    <button key={d.id} type="button" className="xs-kcard" onClick={() => navigate('/buyer-deal-room')}>
                      <div className="xs-kcard__name">{horseNameFor(d)}</div>
                      <div className="xs-kcard__price">{usd(targetFor(d))} target{d.offerAmount ? ` · ${usd(d.offerAmount)} offer` : ''}</div>
                      <StatusChip tone={STAGE_TONE[d.stage]}>{d.name} · {d.channel}</StatusChip>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : leads.length === 0 ? (
        <Card><div className="xs-empty">No deals yet. Start a sale packet to bring a buyer into the pipeline.</div></Card>
      ) : (
        <div className="xs-tablewrap">
          <table className="xs-table">
            <thead><tr><th>Animal</th><th>Buyer</th><th>Stage</th><th>Target</th><th>Offer</th></tr></thead>
            <tbody>
              {leads.map((d) => (
                <tr key={d.id} onClick={() => navigate('/buyer-deal-room')}>
                  <td style={{ fontWeight: 600 }}>{horseNameFor(d)}</td>
                  <td className="xs-muted">{d.name}</td>
                  <td><StatusChip tone={STAGE_TONE[d.stage]}>{d.stage}</StatusChip></td>
                  <td>{usd(targetFor(d))}</td>
                  <td>{d.offerAmount ? usd(d.offerAmount) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card title="Pipeline summary">
        <div className="xs-grid-3">
          <div className="xs-stattile"><div className="xs-stattile__num">{activeCount}</div><div className="xs-stattile__label">Active deals</div></div>
          <div className="xs-stattile"><div className="xs-stattile__num">{closedCount}</div><div className="xs-stattile__label">Closed</div></div>
          <div className="xs-stattile"><div className="xs-stattile__num">{usd(openValue)}</div><div className="xs-stattile__label">Open value</div></div>
        </div>
      </Card>
    </>
  );
}

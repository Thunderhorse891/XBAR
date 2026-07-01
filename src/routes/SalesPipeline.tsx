import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, List, Plus } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { pipelineStages } from '@/data/xbarSaasMock';

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
const allDeals = pipelineStages.flatMap((s) => s.deals.map((d) => ({ ...d, stage: s.label })));

export default function SalesPipeline() {
  const navigate = useNavigate();
  const [view, setView] = useState<'board' | 'list'>('board');
  const openValue = allDeals.reduce((s, d) => s + d.price, 0);

  return (
    <>
      <PageHead
        eyebrow="Transactions"
        title="Sales Pipeline"
        subtitle={`${allDeals.length} active deals · ${usd(openValue)} open value across the operation.`}
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
          {pipelineStages.map((col) => (
            <div key={col.id} className="xs-kcol">
              <div className="xs-kcol__head">
                <span className="xs-kcol__name">{col.label}</span>
                <span className="xs-kcol__count">{col.deals.length}</span>
              </div>
              <div className="xs-kcol__drop">
                {col.deals.length === 0 ? <div className="xs-kcol__empty">—</div> : col.deals.map((d) => (
                  <button key={d.id} type="button" className="xs-kcard" onClick={() => navigate('/buyer-deal-room')}>
                    <div className="xs-kcard__name">{d.horse}</div>
                    <div className="xs-kcard__price">{usd(d.price)} target{d.offer ? ` · ${usd(d.offer)} offer` : ''}</div>
                    <StatusChip tone={d.tone}>{d.note}</StatusChip>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="xs-tablewrap">
          <table className="xs-table">
            <thead><tr><th>Horse</th><th>Stage</th><th>Target</th><th>Offer</th><th>Status</th></tr></thead>
            <tbody>
              {allDeals.map((d) => (
                <tr key={d.id} onClick={() => navigate('/buyer-deal-room')}>
                  <td style={{ fontWeight: 600 }}>{d.horse}</td>
                  <td className="xs-muted">{d.stage}</td>
                  <td>{usd(d.price)}</td>
                  <td>{d.offer ? usd(d.offer) : '—'}</td>
                  <td><StatusChip tone={d.tone}>{d.note}</StatusChip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card title="Pipeline summary">
        <div className="xs-grid-3">
          <div className="xs-stattile"><div className="xs-stattile__num">{allDeals.length}</div><div className="xs-stattile__label">Active deals</div></div>
          <div className="xs-stattile"><div className="xs-stattile__num xs-stattile__num--danger">1</div><div className="xs-stattile__label">Release blocked</div></div>
          <div className="xs-stattile"><div className="xs-stattile__num">{usd(openValue)}</div><div className="xs-stattile__label">Open value</div></div>
        </div>
      </Card>
    </>
  );
}

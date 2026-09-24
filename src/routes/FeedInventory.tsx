import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wheat } from 'lucide-react';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { ActionButton, Card, PageHead } from '@/components/saas';
import { buildCostPerHorse } from '@/lib/costPerHorse';
import { formatCurrency, formatCurrencyCents } from '@/lib/format';

export default function FeedInventory() {
  const navigate = useNavigate();
  const openQuickCreate = useUiStore((state) => state.openQuickCreate);
  const horses = useXbarStore((s) => s.horses);
  const expenseReceipts = useXbarStore((s) => s.expenseReceipts);
  const salesLeads = useXbarStore((s) => s.salesLeads);
  // The same engine as Costs, so the two screens never disagree about what feed
  // costs per horse per day.
  const feedDaily = useMemo(
    () =>
      buildCostPerHorse({ horses, receipts: expenseReceipts, salesLeads }).groups.find(
        (group) => group.group === 'Feed',
      ),
    [horses, expenseReceipts, salesLeads],
  );

  const model = useMemo(() => {
    const feed = expenseReceipts.filter(
      (r) => r.category === 'Feed' || r.category === 'Supplements' || r.category === 'Bedding',
    );
    // Scope the spend total to the current month so it matches the per-day divisor.
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthFeed = feed.filter((r) => (r.receiptDate ?? '').startsWith(monthKey));
    const monthTotal = monthFeed.reduce((sum, r) => sum + r.amount, 0);
    const recent = [...feed].sort((a, b) => b.receiptDate.localeCompare(a.receiptDate)).slice(0, 8);
    return { monthTotal, recent, purchases: feed.length };
  }, [expenseReceipts]);

  return (
    <>
      <PageHead
        eyebrow="Care"
        title="Feed & Supplies"
        subtitle="Track what you spend on hay, grain, supplements, and bedding — and keep the receipts."
        actions={
          <>
            <ActionButton
              variant="primary"
              icon={<Wheat size={15} />}
              onClick={() => openQuickCreate({ action: 'Add Expense' })}
            >
              Log Feed Purchase
            </ActionButton>
          </>
        }
      />

      <div className="xs-grid-3">
        <Card>
          <div className="xs-card__sub">Feed &amp; supply spend (this month)</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>
            {formatCurrency(model.monthTotal)}
          </div>
        </Card>
        <Card>
          <div className="xs-card__sub">Feed per horse / day (last 90 days)</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>
            {feedDaily && feedDaily.perHorsePerDay !== null ? formatCurrencyCents(feedDaily.perHorsePerDay) : '—'}
          </div>
          <ActionButton size="sm" onClick={() => navigate('/costs')}>
            See every cost per horse
          </ActionButton>
        </Card>
        <Card>
          <div className="xs-card__sub">Purchases logged</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{model.purchases}</div>
        </Card>
      </div>

      <Card title="Recent feed &amp; supply purchases" subtitle="Pulled from your expenses">
        {model.recent.length ? (
          <div className="xs-mlist">
            {model.recent.map((r) => (
              <div key={r.id} className="xs-mrow">
                <span className="xs-mrow__main">
                  <span className="xs-mrow__title">{r.title}</span>
                  <span className="xs-mrow__detail">
                    {r.vendor} · {r.receiptDate}
                  </span>
                </span>
                <span style={{ fontWeight: 700 }}>{formatCurrencyCents(r.amount)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="xs-empty">
            <div className="xs-empty__title">No feed purchases yet</div>
            <div className="xs-empty__sub">
              Add feed, supplement, and bedding expenses to track your monthly cost per horse.
            </div>
            <ActionButton variant="primary" onClick={() => navigate('/expenses')}>
              Add an expense
            </ActionButton>
          </div>
        )}
        <ActionButton size="sm" block onClick={() => navigate('/expenses')}>
          Open expenses
        </ActionButton>
      </Card>
    </>
  );
}

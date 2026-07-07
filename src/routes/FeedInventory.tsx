import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Wheat } from 'lucide-react';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { ActionButton, Card, PageHead } from '@/components/saas';

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export default function FeedInventory() {
  const navigate = useNavigate();
  const pushToast = useUiStore((state) => state.pushToast);
  const horses = useXbarStore((s) => s.horses);
  const expenseReceipts = useXbarStore((s) => s.expenseReceipts);
  const toast = (m: string) => pushToast({ title: 'Feed & Supplies', message: m, tone: 'success' });

  const model = useMemo(() => {
    const feed = expenseReceipts.filter(
      (r) => r.category === 'Feed' || r.category === 'Supplements' || r.category === 'Bedding',
    );
    // Scope the spend total to the current month so it matches the per-day divisor.
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthFeed = feed.filter((r) => (r.receiptDate ?? '').startsWith(monthKey));
    const monthTotal = monthFeed.reduce((sum, r) => sum + r.amount, 0);
    const daysElapsed = now.getDate(); // days so far this month
    const perHorseDay = horses.length && daysElapsed ? monthTotal / (horses.length * daysElapsed) : 0;
    const recent = [...feed].sort((a, b) => b.receiptDate.localeCompare(a.receiptDate)).slice(0, 8);
    return { monthTotal, perHorseDay, recent, purchases: feed.length };
  }, [expenseReceipts, horses.length]);

  return (
    <>
      <PageHead
        eyebrow="Care"
        title="Feed & Supplies"
        subtitle="Track what you spend on hay, grain, supplements, and bedding — and keep the receipts."
        actions={
          <>
            <ActionButton icon={<Wheat size={15} />} onClick={() => toast('Feed logged')}>
              Log Feed
            </ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/expenses')}>
              Add Expense
            </ActionButton>
          </>
        }
      />

      <div className="xs-grid-3">
        <Card>
          <div className="xs-card__sub">Feed &amp; supply spend (this month)</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>
            {usd(model.monthTotal)}
          </div>
        </Card>
        <Card>
          <div className="xs-card__sub">Roughly per horse / day (this month)</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>
            {horses.length ? usd(model.perHorseDay) : '—'}
          </div>
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
                <span style={{ fontWeight: 700 }}>{usd(r.amount)}</span>
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

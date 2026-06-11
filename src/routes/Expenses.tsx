import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommandBrief } from '@/components/CommandBrief';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { formatCompactCurrency, formatCurrency, formatDateLabel } from '@/lib/format';
import { buildProfitPortfolio } from '@/lib/profitIntelligence';
import { profitIntelligenceGate } from '@/lib/subscriptionGates';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';
import type { ExpenseCategory } from '@/types/xbar';
import { EXPENSE_CATEGORIES } from '@/features/expenses/constants';
import { matchesSearch } from '@/features/expenses/helpers';
import type { ExpenseFilter } from '@/features/expenses/types';
import './operationsExperience.css';

const RANCH_WIDE = 'Ranch-wide';

function monthKey(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

export default function Expenses() {
  const navigate = useNavigate();
  const pushToast = useUiStore((state) => state.pushToast);
  const horses = useXbarStore((state) => state.horses);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const subscription = useXbarStore((state) => state.subscription);
  const addExpenseReceipt = useXbarStore((state) => state.addExpenseReceipt);
  const updateHorse = useXbarStore((state) => state.updateHorse);
  const roleWorkspace = useCurrentRoleWorkspace();
  const canManageBudget = useCurrentRoleCapability('manageAssets');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ExpenseFilter>('All');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const profitPortfolio = useMemo(() => buildProfitPortfolio(horses, expenseReceipts, salesLeads), [expenseReceipts, horses, salesLeads]);
  const [profitHorseId, setProfitHorseId] = useState(horses[0]?.id ?? '');
  const profitHorse = horses.find((horse) => horse.id === profitHorseId) ?? horses[0];
  const profitProfile = profitPortfolio.find((profile) => profile.horseId === profitHorse?.id);
  const [costBasis, setCostBasis] = useState(String(profitHorse?.costBasis ?? 0));
  const [askingPrice, setAskingPrice] = useState(String(profitHorse?.sale.askPrice ?? 0));
  const profitGate = profitIntelligenceGate(subscription);
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);
  const [draft, setDraft] = useState({
    horseId: '',
    title: '',
    category: 'Feed' as ExpenseCategory,
    vendor: '',
    amount: '',
    receiptDate: new Date().toISOString().slice(0, 10),
    notes: '',
    uploadedBy: roleWorkspace.label,
  });

  useEffect(() => {
    if (intakeOpen) {
      firstFieldRef.current?.focus();
    }
  }, [intakeOpen]);

  // Business-control math: month buckets, category trend, horse and vendor totals.
  const spend = useMemo(() => {
    const now = new Date();
    // Last six month keys, oldest first; index 5 is the current month.
    const keys: string[] = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      keys.push(monthKey(date.getFullYear(), date.getMonth()));
    }
    const currentKey = keys[5];
    const lastKey = keys[4];
    const trailingKeys = keys.slice(2, 5); // the three full months before the current one

    const monthTotals = new Map<string, number>(keys.map((key) => [key, 0]));
    const categoryMtd = new Map<ExpenseCategory, number>();
    const categoryTrailing = new Map<ExpenseCategory, number>();
    const horseTotals = new Map<string, number>();
    const vendorTotals = new Map<string, number>();
    let receiptsThisMonth = 0;

    expenseReceipts.forEach((receipt) => {
      const key = (receipt.receiptDate ?? '').slice(0, 7);
      if (monthTotals.has(key)) {
        monthTotals.set(key, (monthTotals.get(key) ?? 0) + receipt.amount);
      }
      if (key === currentKey) {
        receiptsThisMonth += 1;
        categoryMtd.set(receipt.category, (categoryMtd.get(receipt.category) ?? 0) + receipt.amount);
      }
      if (trailingKeys.includes(key)) {
        categoryTrailing.set(receipt.category, (categoryTrailing.get(receipt.category) ?? 0) + receipt.amount);
      }
      const horseBucket = receipt.horseId ?? RANCH_WIDE;
      horseTotals.set(horseBucket, (horseTotals.get(horseBucket) ?? 0) + receipt.amount);
      const vendorBucket = receipt.vendor.trim() || 'Unspecified vendor';
      vendorTotals.set(vendorBucket, (vendorTotals.get(vendorBucket) ?? 0) + receipt.amount);
    });

    const thisMonthTotal = monthTotals.get(currentKey) ?? 0;
    const lastMonthTotal = monthTotals.get(lastKey) ?? 0;
    const trailingAverage = trailingKeys.reduce((sum, key) => sum + (monthTotals.get(key) ?? 0), 0) / 3;
    const momDelta = lastMonthTotal > 0 ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : null;

    const trend = keys.map((key) => {
      const [year, month] = key.split('-').map(Number);
      return {
        key,
        label: new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short' }),
        total: monthTotals.get(key) ?? 0,
      };
    });
    const trendMax = Math.max(...trend.map((item) => item.total), 1);

    const categories = Array.from(categoryMtd.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((left, right) => right.amount - left.amount);

    // Worst category vs its own trailing 3-month average.
    let categoryRisk: { category: ExpenseCategory; overagePercent: number } | null = null;
    categories.forEach(({ category, amount }) => {
      const average = (categoryTrailing.get(category) ?? 0) / 3;
      if (average > 0 && amount > average) {
        const overagePercent = Math.round((amount / average - 1) * 100);
        if (!categoryRisk || overagePercent > categoryRisk.overagePercent) {
          categoryRisk = { category, overagePercent };
        }
      }
    });

    const topHorses = Array.from(horseTotals.entries())
      .map(([id, amount]) => ({
        id,
        name: id === RANCH_WIDE ? RANCH_WIDE : horses.find((horse) => horse.id === id)?.name ?? 'Unknown horse',
        amount,
      }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 5);

    const topVendors = Array.from(vendorTotals.entries())
      .map(([vendor, amount]) => ({ vendor, amount }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 5);

    return {
      thisMonthTotal,
      lastMonthTotal,
      trailingAverage,
      momDelta,
      receiptsThisMonth,
      trend,
      trendMax,
      categories,
      categoryRisk: categoryRisk as { category: ExpenseCategory; overagePercent: number } | null,
      topHorses,
      topVendors,
    };
  }, [expenseReceipts, horses]);

  const heroStatus =
    spend.trailingAverage > 0 && spend.thisMonthTotal > spend.trailingAverage * 1.2
      ? { label: 'Spend over trend', tone: 'rose' as const }
      : spend.trailingAverage > 0 && spend.thisMonthTotal > spend.trailingAverage
        ? { label: 'Above trend', tone: 'amber' as const }
        : { label: 'Within trend', tone: 'blue' as const };

  const heroRisks = spend.categoryRisk
    ? [
        {
          label: `${spend.categoryRisk.category} running ${spend.categoryRisk.overagePercent}% above trend`,
          severity: spend.categoryRisk.overagePercent >= 50 ? ('rose' as const) : ('amber' as const),
        },
      ]
    : [];

  const filteredReceipts = useMemo(() => {
    return expenseReceipts
      .filter((receipt) => {
        const horse = horses.find((item) => item.id === receipt.horseId);
        return (
          (categoryFilter === 'All' || receipt.category === categoryFilter) &&
          matchesSearch([receipt.title, receipt.vendor, receipt.category, receipt.notes, horse?.name, horse?.barnName], query)
        );
      })
      .sort((left, right) => Date.parse(right.receiptDate) - Date.parse(left.receiptDate));
  }, [categoryFilter, expenseReceipts, horses, query]);

  async function handleReceiptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingReceipt(true);
    const result = await addExpenseReceipt({
      horseId: draft.horseId || undefined,
      title: draft.title,
      category: draft.category,
      vendor: draft.vendor,
      amount: Number(draft.amount),
      receiptDate: draft.receiptDate,
      notes: draft.notes,
      uploadedBy: draft.uploadedBy,
      file: receiptFile,
    });
    pushToast({
      title: result.ok ? 'Receipt logged' : 'Receipt blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setDraft((current) => ({ ...current, horseId: '', title: '', vendor: '', amount: '', notes: '' }));
      setReceiptFile(null);
      firstFieldRef.current?.focus();
    }
    setSavingReceipt(false);
  }

  const momDeltaLabel =
    spend.momDelta === null ? '—' : `${spend.momDelta >= 0 ? '+' : ''}${Math.round(spend.momDelta)}%`;

  return (
    <div className="ops-experience">
      <CommandBrief
        eyebrow="Budget & Expenses"
        entity="Spending"
        status={heroStatus}
        evidence={[
          { label: 'This month', value: formatCurrency(spend.thisMonthTotal) },
          { label: 'Last month', value: formatCurrency(spend.lastMonthTotal) },
          { label: 'MoM delta', value: momDeltaLabel },
          { label: 'Receipts this month', value: String(spend.receiptsThisMonth) },
        ]}
        risks={heroRisks}
        nextAction={{ label: 'Log a receipt', onClick: () => setIntakeOpen(true) }}
        secondaryActions={[{ label: 'Go to document upload', onClick: () => navigate('/documents?upload=1') }]}
        variant="compact"
      />

      <div className="ops-workspace ops-workspace--split">
        <section className="ops-panel ops-panel--wide">
          <div className="ops-section-heading">
            <div><span className="section-eyebrow">Profit intelligence</span><h2>Know the break-even before setting the sale price</h2></div>
            <Pill tone={profitGate ? 'amber' : 'emerald'}>{profitGate ? 'Ranch Ops' : 'Live margin'}</Pill>
          </div>
          {profitProfile ? (
            <>
              <div className="metric-grid">
                <MetricCard label="Cost basis" value={formatCompactCurrency(profitProfile.costBasis)} detail="Acquisition or retained basis" />
                <MetricCard label="Linked spend" value={formatCompactCurrency(profitProfile.spend)} detail="Feed, vet, farrier, training, and receipts" tone="blue" />
                <MetricCard label="Break-even" value={formatCompactCurrency(profitProfile.breakEven)} detail="Cost basis plus linked spend" tone="amber" />
                <MetricCard label="Safe sale price" value={formatCompactCurrency(profitProfile.safeSalePrice)} detail="Break-even plus a 15% operating buffer" tone={profitProfile.profitLoss >= 0 ? 'emerald' : 'rose'} />
              </div>
              <div className="stack-list">
                {profitPortfolio.slice(0, 8).map((profile) => (
                  <button className={`stack-item stack-item--interactive${profile.horseId === profitProfile.horseId ? ' stack-item--selected' : ''}`} type="button" key={profile.horseId} onClick={() => {
                    const horse = horses.find((item) => item.id === profile.horseId);
                    setProfitHorseId(profile.horseId);
                    setCostBasis(String(horse?.costBasis ?? 0));
                    setAskingPrice(String(horse?.sale.askPrice ?? 0));
                  }}>
                    <div className="stack-item__top"><div><div className="stack-item__title">{profile.horseName}</div><div className="stack-item__copy">Break-even {formatCurrency(profile.breakEven)} · sale value {formatCurrency(profile.salePrice)}</div></div><Pill tone={profile.profitLoss >= 0 ? 'emerald' : 'rose'}>{formatCurrency(profile.profitLoss)}</Pill></div>
                  </button>
                ))}
              </div>
            </>
          ) : <EmptyState compact title="No horses to price yet" description="Create a horse record, then link receipts to calculate break-even and safe sale price." />}
        </section>
        <aside className="ops-panel ops-panel--form">
          <div className="ops-section-heading ops-section-heading--compact"><div><span className="section-eyebrow">Pricing action</span><h2>{profitHorse?.name ?? 'Select horse'}</h2></div><Pill tone={profitGate ? 'amber' : 'blue'}>{profitGate ? 'Upgrade to unlock' : 'Editable'}</Pill></div>
          {profitGate ? <div className="stack-item"><div className="stack-item__title">Turn receipts into pricing decisions</div><div className="stack-item__copy">{profitGate}</div><button className="button button--primary button--compact" type="button" onClick={() => navigate('/subscriptions')}>Upgrade to unlock</button></div> : (
            <div className="ops-form">
              <label className="field-stack"><span className="field-label">Cost basis</span><input className="field-input" type="number" min="0" value={costBasis} onChange={(event) => setCostBasis(event.target.value)} /></label>
              <label className="field-stack"><span className="field-label">Asking price</span><input className="field-input" type="number" min="0" value={askingPrice} onChange={(event) => setAskingPrice(event.target.value)} /></label>
              <button className="button button--primary ops-full-button" type="button" disabled={!profitHorse || !canManageBudget} onClick={() => {
                if (!profitHorse) return;
                const result = updateHorse(profitHorse.id, { costBasis: Number(costBasis), askPrice: Number(askingPrice) });
                pushToast({ title: result.ok ? 'Sale economics updated' : 'Pricing update blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
              }}>Save pricing decision</button>
            </div>
          )}
        </aside>
      </div>

      {intakeOpen ? (
        <aside id="expense-intake" className="ops-panel ops-panel--form">
          <div className="ops-section-heading ops-section-heading--compact">
            <div>
              <span className="section-eyebrow">Log receipt</span>
              <h2>Add the cost while it is still fresh</h2>
            </div>
            <div className="inline-actions inline-actions--card">
              <Pill tone={canManageBudget ? 'blue' : 'slate'}>{canManageBudget ? 'Enabled' : 'Read only'}</Pill>
              <button className="button button--ghost button--compact" type="button" onClick={() => setIntakeOpen(false)}>
                Close
              </button>
            </div>
          </div>

          <form className="ops-form" onSubmit={handleReceiptSubmit}>
            <label className="field-stack">
              <span className="field-label">Category</span>
              <select ref={firstFieldRef} className="field-input" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as ExpenseCategory }))} disabled={!canManageBudget || savingReceipt}>
                {EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Horse</span>
              <select className="field-input" value={draft.horseId} onChange={(event) => setDraft((current) => ({ ...current, horseId: event.target.value }))} disabled={!canManageBudget || savingReceipt}>
                <option value="">Ranch-wide</option>
                {horses.map((horse) => <option key={horse.id} value={horse.id}>{horse.name}</option>)}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Receipt label</span>
              <input className="field-input" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Feed delivery" disabled={!canManageBudget || savingReceipt} />
            </label>
            <label className="field-stack">
              <span className="field-label">Vendor</span>
              <input className="field-input" value={draft.vendor} onChange={(event) => setDraft((current) => ({ ...current, vendor: event.target.value }))} placeholder="Co-op, vet, farrier" disabled={!canManageBudget || savingReceipt} />
            </label>
            <label className="field-stack">
              <span className="field-label">Amount</span>
              <input className="field-input" type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))} placeholder="240.00" disabled={!canManageBudget || savingReceipt} />
            </label>
            <label className="field-stack">
              <span className="field-label">Receipt date</span>
              <input className="field-input" type="date" value={draft.receiptDate} onChange={(event) => setDraft((current) => ({ ...current, receiptDate: event.target.value }))} disabled={!canManageBudget || savingReceipt} />
            </label>
            <label className="field-stack">
              <span className="field-label">Uploaded by</span>
              <input className="field-input" value={draft.uploadedBy} onChange={(event) => setDraft((current) => ({ ...current, uploadedBy: event.target.value }))} disabled={!canManageBudget || savingReceipt} />
            </label>
            <label className="field-stack">
              <span className="field-label">Receipt file</span>
              <input className="field-input" type="file" accept=".pdf,image/*" onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)} disabled={!canManageBudget || savingReceipt} />
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Notes</span>
              <textarea className="field-textarea" rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional note." disabled={!canManageBudget || savingReceipt} />
            </label>
            <button className="button button--primary ops-full-button" type="submit" disabled={!canManageBudget || savingReceipt}>
              {savingReceipt ? 'Logging...' : 'Log receipt'}
            </button>
            {receiptFile ? <Pill tone="slate">{receiptFile.name}</Pill> : null}
          </form>
        </aside>
      ) : null}

      <div className="ops-workspace ops-workspace--columns">
        <Panel title="Category breakdown" description="Month-to-date spend by category." meta={<Pill tone="blue">This month</Pill>}>
          {spend.categories.length ? (
            <div className="stack-list">
              {spend.categories.map(({ category, amount }) => {
                const share = spend.thisMonthTotal > 0 ? (amount / spend.thisMonthTotal) * 100 : 0;
                const isRiskCategory = spend.categoryRisk?.category === category;
                return (
                  <div key={category} className="stack-item">
                    <div className="stack-item__top">
                      <div className="stack-item__title">{category}</div>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(amount)} · {Math.round(share)}%
                      </span>
                    </div>
                    <ProgressBar value={share} tone={isRiskCategory ? (spend.categoryRisk && spend.categoryRisk.overagePercent >= 50 ? 'rose' : 'amber') : 'blue'} />
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No spend this month" description="Log a receipt and the category split appears here." />
          )}
        </Panel>

        <Panel title="6-month trend" description="Monthly totals, oldest to newest." meta={<Pill tone="slate">Trailing view</Pill>}>
          {expenseReceipts.length ? (
            <div className="stack-list">
              {spend.trend.map((month, index) => (
                <div key={month.key} className="stack-item">
                  <div className="stack-item__top">
                    <div className="stack-item__title">{month.label}{index === spend.trend.length - 1 ? ' (current)' : ''}</div>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(month.total)}</span>
                  </div>
                  <ProgressBar value={(month.total / spend.trendMax) * 100} tone={index === spend.trend.length - 1 ? 'blue' : 'slate'} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No trend yet" description="Monthly totals build up as receipts are logged." />
          )}
        </Panel>
      </div>

      <div className="ops-workspace ops-workspace--columns">
        <Panel title="Cost per horse" description="Top five by total spend; receipts without a horse group as Ranch-wide." meta={<Pill tone="slate">All time</Pill>}>
          {spend.topHorses.length ? (
            <div className="stack-list">
              {spend.topHorses.map((row) => (
                <div key={row.id} className="stack-item">
                  <div className="stack-item__top">
                    <div className="stack-item__title">{row.name}</div>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(row.amount)}</span>
                  </div>
                  <ProgressBar value={(row.amount / (spend.topHorses[0]?.amount || 1)) * 100} tone="blue" />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No horse costs yet" description="Receipts tied to horses surface their cost here." />
          )}
        </Panel>

        <Panel title="Top vendors" description="Top five vendors by total spend." meta={<Pill tone="slate">All time</Pill>}>
          {spend.topVendors.length ? (
            <div className="stack-list">
              {spend.topVendors.map((row) => (
                <div key={row.vendor} className="stack-item">
                  <div className="stack-item__top">
                    <div className="stack-item__title">{row.vendor}</div>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(row.amount)}</span>
                  </div>
                  <ProgressBar value={(row.amount / (spend.topVendors[0]?.amount || 1)) * 100} tone="slate" />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No vendors yet" description="Vendor totals appear once receipts carry a vendor name." />
          )}
        </Panel>
      </div>

      <section className="ops-panel ops-panel--wide">
        <div className="ops-section-heading">
          <div>
            <span className="section-eyebrow">Recent receipts</span>
            <h2>Ranch costs with the horse context attached</h2>
          </div>
          <Pill tone="blue">{filteredReceipts.length} shown</Pill>
        </div>

        <div className="ops-toolbar">
          <label className="ops-search">
            <span className="sr-only">Search expenses</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vendor, horse, category, receipt..." />
          </label>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as ExpenseFilter)} aria-label="Filter expense category">
            <option value="All">All categories</option>
            {EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>

        {filteredReceipts.length ? (
          <div className="ops-record-grid">
            {filteredReceipts.map((receipt) => {
              const horse = horses.find((item) => item.id === receipt.horseId);
              const content = <>
                <div className="ops-record-card__top">
                  <div>
                    <span>{receipt.category}</span>
                    <strong>{receipt.title}</strong>
                  </div>
                  <Pill tone="blue">{formatCurrency(receipt.amount)}</Pill>
                </div>
                <p>{receipt.notes || 'No notes added.'}</p>
                <div className="ops-record-meta">
                  <span>{horse?.name ?? RANCH_WIDE}</span>
                  <span>{receipt.vendor || 'Vendor pending'}</span>
                  <span>{formatDateLabel(receipt.receiptDate)}</span>
                </div>
              </>;
              return receipt.horseId ? (
                <button key={receipt.id} className="ops-record-card" type="button" onClick={() => receipt.horseId ? navigate(`/horses/${receipt.horseId}`) : undefined}>
                  {content}
                </button>
              ) : (
                <article key={receipt.id} className="ops-record-card ops-record-card--static" title="Ranch-wide receipt with no linked horse record.">
                  {content}
                </article>
              );
            })}
          </div>
        ) : expenseReceipts.length ? (
          <EmptyState compact title="No receipts match" description="Adjust the search or category filter." />
        ) : (
          <EmptyState
            title="Start with the receipts already in your truck, tack room, and inbox"
            description="Feed, vet, farrier, travel, and supply costs become easier to trust once every receipt has a place."
            action={
              <button className="button button--primary" type="button" onClick={() => setIntakeOpen(true)}>
                Log a receipt
              </button>
            }
          />
        )}
      </section>

      <div className="ops-workspace ops-workspace--columns">
        <Panel title="Where this connects" meta={<Pill tone="slate">Operating system</Pill>}>
          <div className="ops-link-list">
            <button type="button" onClick={() => navigate('/documents?upload=1')}>Go to document upload (Document Vault)</button>
            <button type="button" onClick={() => navigate('/medical')}>Review care costs beside health records</button>
            <button type="button" onClick={() => navigate('/horses')}>Open the horse profiles tied to spending</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

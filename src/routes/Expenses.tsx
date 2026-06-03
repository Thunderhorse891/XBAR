import { type FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { buildBudgetSummary } from '@/lib/dashboardOps';
import { formatCompactCurrency, formatCurrency, formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';
import type { ExpenseCategory } from '@/types/xbar';
import { EXPENSE_CATEGORIES } from '@/features/expenses/constants';
import { matchesSearch } from '@/features/expenses/helpers';
import type { ExpenseFilter } from '@/features/expenses/types';
import './operationsExperience.css';

export default function Expenses() {
  const pushToast = useUiStore((state) => state.pushToast);
  const horses = useXbarStore((state) => state.horses);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const addExpenseReceipt = useXbarStore((state) => state.addExpenseReceipt);
  const roleWorkspace = useCurrentRoleWorkspace();
  const canManageBudget = useCurrentRoleCapability('manageAssets');
  const budgetSummary = useMemo(() => buildBudgetSummary(expenseReceipts), [expenseReceipts]);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ExpenseFilter>('All');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [savingReceipt, setSavingReceipt] = useState(false);
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

  const monthReceipts = useMemo(() => {
    return expenseReceipts.filter((receipt) => {
      if (!receipt.receiptDate) return false;
      const d = new Date(receipt.receiptDate.includes('T') ? receipt.receiptDate : `${receipt.receiptDate}T12:00:00`);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return key === budgetSummary.monthKey;
    });
  }, [expenseReceipts, budgetSummary.monthKey]);

  const ranchWideCount = monthReceipts.filter((receipt) => !receipt.horseId).length;
  const horseLinkedCount = monthReceipts.length - ranchWideCount;
  const largestReceipt = monthReceipts.slice().sort((left, right) => right.amount - left.amount)[0];

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
    }
    setSavingReceipt(false);
  }

  return (
    <div className="ops-experience">
      <div className="surface-hero surface-hero--dark">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Budget & Expenses</span>
            <div className="surface-hero__actions" style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button className="button button--primary" type="button" onClick={() => document.getElementById('expense-intake')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                Log receipt
              </button>
              <Link className="button button--ghost" to="/documents?upload=1">Upload expense file</Link>
            </div>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat">
              <span>This month</span>
              <strong>{formatCompactCurrency(budgetSummary.total)}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Receipts</span>
              <strong>{budgetSummary.receiptCount}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Feed</span>
              <strong>{formatCompactCurrency(budgetSummary.feed)}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Health</span>
              <strong>{formatCompactCurrency(budgetSummary.health)}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="This month" value={formatCompactCurrency(budgetSummary.total)} detail="Total operating spend" tone="blue" />
        <MetricCard label="Horse linked" value={String(horseLinkedCount)} detail="Receipts tied to a horse this month" tone="emerald" />
        <MetricCard label="Ranch-wide" value={String(ranchWideCount)} detail="Shared costs not tied to a horse" tone="slate" />
        <MetricCard label="Largest" value={largestReceipt ? formatCompactCurrency(largestReceipt.amount) : '$0'} detail={largestReceipt?.title ?? 'No receipts this month'} tone="amber" />
      </div>

      <div className="ops-workspace ops-workspace--split">
        <section className="ops-panel ops-panel--wide">
          <div className="ops-section-heading">
            <div>
              <span className="section-eyebrow">Expense ledger</span>
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
                return (
                  <Link key={receipt.id} className="ops-record-card" to={receipt.horseId ? `/horses/${receipt.horseId}` : '/expenses'}>
                    <div className="ops-record-card__top">
                      <div>
                        <span>{receipt.category}</span>
                        <strong>{receipt.title}</strong>
                      </div>
                      <Pill tone="blue">{formatCurrency(receipt.amount)}</Pill>
                    </div>
                    <p>{receipt.notes || 'No notes added.'}</p>
                    <div className="ops-record-meta">
                      <span>{horse?.name ?? 'Ranch-wide'}</span>
                      <span>{receipt.vendor || 'Vendor pending'}</span>
                      <span>{formatDateLabel(receipt.receiptDate)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : expenseReceipts.length ? (
            <EmptyState compact title="No receipts match" description="Adjust the search or category filter." />
          ) : (
            <EmptyState title="Start with the receipts already in your truck, tack room, and inbox" description="Feed, vet, farrier, travel, and supply costs become easier to trust once every receipt has a place." />
          )}
        </section>

        <aside id="expense-intake" className="ops-panel ops-panel--form">
          <div className="ops-section-heading ops-section-heading--compact">
            <div>
              <span className="section-eyebrow">Log receipt</span>
              <h2>Add the cost while it is still fresh</h2>
            </div>
            <Pill tone={canManageBudget ? 'blue' : 'slate'}>{canManageBudget ? 'Enabled' : 'Read only'}</Pill>
          </div>

          <form className="ops-form" onSubmit={handleReceiptSubmit}>
            <label className="field-stack">
              <span className="field-label">Category</span>
              <select className="field-input" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as ExpenseCategory }))} disabled={!canManageBudget || savingReceipt}>
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
      </div>

      <div className="ops-workspace ops-workspace--columns">
        <Panel title="Category totals" meta={<Pill tone="blue">This month</Pill>}>
          {budgetSummary.categories.length ? (
            <div className="stack-list">
              {budgetSummary.categories.map((category) => (
                <div key={category.category} className="stack-item">
                  <div className="stack-item__top">
                    <div className="stack-item__title">{category.category}</div>
                    <Pill tone="slate">{formatCurrency(category.amount)}</Pill>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No category totals yet" description="Totals appear after receipts are logged." />
          )}
        </Panel>
        <Panel title="Where this connects" meta={<Pill tone="slate">Operating system</Pill>}>
          <div className="ops-link-list">
            <Link to="/documents?upload=1">Upload receipt files to the Document Vault</Link>
            <Link to="/medical">Review care costs beside health records</Link>
            <Link to="/horses">Open the horse profiles tied to spending</Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}

import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { buildBudgetSummary, buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { formatCompactCurrency, formatCurrency, formatDateLabel } from '@/lib/format';
import { useCurrentRoleCapability, useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';
import { useUiStore } from '@/store/useUiStore';
import type { ExpenseCategory } from '@/types/xbar';

type DashboardMenuState =
  | { type: 'horse'; id: string; x: number; y: number }
  | { type: 'record'; id: string; x: number; y: number }
  | { type: 'lead'; id: string; x: number; y: number }
  | { type: 'expense'; id: string; x: number; y: number };

const expenseCategories: ExpenseCategory[] = ['Feed', 'Wormer', 'Dental Float', 'Farrier', 'Vet Care', 'Supplements', 'Bedding', 'Travel'];

const careSignalTone: Record<'due' | 'watch' | 'clear', 'rose' | 'amber' | 'emerald'> = {
  due: 'rose',
  watch: 'amber',
  clear: 'emerald',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const pushToast = useUiStore((state) => state.pushToast);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const intakeBatches = useXbarStore((state) => state.intakeBatches);
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const addExpenseReceipt = useXbarStore((state) => state.addExpenseReceipt);
  const roleWorkspace = useCurrentRoleWorkspace();
  const canManageBudget = useCurrentRoleCapability('manageAssets');
  const [menuState, setMenuState] = useState<DashboardMenuState | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [receiptDraft, setReceiptDraft] = useState({
    horseId: '',
    title: '',
    category: 'Feed' as ExpenseCategory,
    vendor: '',
    amount: '',
    receiptDate: new Date().toISOString().slice(0, 10),
    notes: '',
    uploadedBy: roleWorkspace.label,
  });

  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
  const transferGaps = buildTransferGapRows(horses, ownershipRecords, documents);
  const careBoard = buildCareBoardRows(horses, documents, expenseReceipts);
  const budgetSummary = buildBudgetSummary(expenseReceipts);
  const careDueCount = careBoard.filter((row) => row.signals.some((signal) => signal.status === 'due')).length;
  const cogginsWatchCount = careBoard.filter((row) => row.signals.some((signal) => signal.key === 'coggins' && signal.status !== 'clear')).length;
  const qualifiedBuyerCount = salesLeads.filter((lead) => lead.stage === 'Qualified' || lead.stage === 'Offer').length;
  const feedReserveAsset = ranchAssets.find((asset) => asset.category === 'Feed & Supply');
  const recentBatches = intakeBatches.slice(0, 4);

  const menuHorse = menuState?.type === 'horse' ? horses.find((horse) => horse.id === menuState.id) : undefined;
  const menuRecord = menuState?.type === 'record' ? ownershipRecords.find((record) => record.id === menuState.id) : undefined;
  const menuLead = menuState?.type === 'lead' ? salesLeads.find((lead) => lead.id === menuState.id) : undefined;
  const menuExpense = menuState?.type === 'expense' ? expenseReceipts.find((receipt) => receipt.id === menuState.id) : undefined;
  const menuRecordHorse = horses.find((horse) => horse.id === menuRecord?.horseId);
  const menuLeadHorse = horses.find((horse) => horse.id === menuLead?.horseId);
  const menuExpenseHorse = horses.find((horse) => horse.id === menuExpense?.horseId);
  const menuItems = menuHorse
    ? [
        {
          id: 'open-horse',
          label: 'Open horse profile',
          onSelect: () => navigate(`/horses/${menuHorse.id}`),
        },
        {
          id: 'open-profile',
          label: 'Open buyer profile',
          onSelect: () => navigate(`/profiles/${menuHorse.id}`),
        },
      ]
    : menuRecord
      ? [
          {
            id: 'open-ownership',
            label: 'Open ownership',
            onSelect: () => navigate('/ownership'),
          },
          ...(menuRecordHorse
            ? [
                {
                  id: 'open-record-horse',
                  label: 'Open horse profile',
                  onSelect: () => navigate(`/horses/${menuRecordHorse.id}`),
                },
              ]
            : []),
        ]
      : menuLead
        ? [
            {
              id: 'open-sales',
              label: 'Open sales board',
              onSelect: () => navigate('/sales'),
            },
            ...(menuLeadHorse
              ? [
                  {
                    id: 'open-lead-horse',
                    label: 'Open horse profile',
                    onSelect: () => navigate(`/horses/${menuLeadHorse.id}`),
                  },
                ]
              : []),
          ]
        : menuExpense
          ? [
              {
                id: 'open-budget',
                label: 'Open dashboard',
                onSelect: () => navigate('/'),
              },
              ...(menuExpenseHorse
                ? [
                    {
                      id: 'open-expense-horse',
                      label: 'Open horse profile',
                      onSelect: () => navigate(`/horses/${menuExpenseHorse.id}`),
                    },
                  ]
                : []),
            ]
          : [];
  const hasWorkspaceData = Boolean(
    horses.length ||
    documents.length ||
    ownershipRecords.length ||
    expenseReceipts.length ||
    salesLeads.length ||
    intakeBatches.length ||
    ranchAssets.length,
  );

  if (!hasWorkspaceData) {
    return (
      <>
        <PageHeader
          title="Operations"
          actions={
            <>
              <Link to="/horses?new=1" className="button button--primary button--compact">
                New horse
              </Link>
              <Link to="/documents?upload=1" className="button button--ghost button--compact">
                Upload docs
              </Link>
            </>
          }
        />

        <div className="dashboard-grid dashboard-grid--primary">
          <Panel eyebrow="Workspace" title="Start the ledger">
            <EmptyState
              title="No records yet"
              description="Create the first horse, upload a packet, or import a backup to start the workspace."
              action={
                <div className="inline-actions">
                  <Link to="/horses?new=1" className="button button--primary button--compact">
                    Create horse
                  </Link>
                  <Link to="/documents?upload=1" className="button button--ghost button--compact">
                    Batch intake
                  </Link>
                  <Link to="/settings" className="button button--ghost button--compact">
                    Settings
                  </Link>
                </div>
              }
            />
          </Panel>

          <Panel eyebrow="Quick start" title="What to do first">
            <div className="stack-list">
              <div className="stack-item">
                <div className="stack-item__title">Horse record</div>
                <div className="stack-item__copy">Add one horse or let intake create it from registration, coggins, and transfer papers.</div>
              </div>
              <div className="stack-item">
                <div className="stack-item__title">Documents</div>
                <div className="stack-item__copy">Upload the first packet so trust scoring, ownership, and sale readiness have source files.</div>
              </div>
              <div className="stack-item">
                <div className="stack-item__title">Budget</div>
                <div className="stack-item__copy">Log feed, wormer, dental float, and vet receipts to start the operating budget view.</div>
              </div>
            </div>
          </Panel>
        </div>
      </>
    );
  }

  async function handleReceiptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingReceipt(true);
    const result = await addExpenseReceipt({
      horseId: receiptDraft.horseId || undefined,
      title: receiptDraft.title,
      category: receiptDraft.category,
      vendor: receiptDraft.vendor,
      amount: Number(receiptDraft.amount),
      receiptDate: receiptDraft.receiptDate,
      notes: receiptDraft.notes,
      uploadedBy: receiptDraft.uploadedBy,
      file: receiptFile,
    });
    pushToast({
      title: result.ok ? 'Receipt logged' : 'Receipt blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setReceiptDraft((current) => ({
        ...current,
        horseId: '',
        title: '',
        vendor: '',
        amount: '',
        notes: '',
      }));
      setReceiptFile(null);
    }
    setSavingReceipt(false);
  }

  return (
    <>
      <PageHeader
        title="Operations"
        actions={
          <>
            <Link to="/documents" className="button button--ghost button--compact">
              Review docs
            </Link>
            <Link to="/horses?new=1" className="button button--primary button--compact">
              New horse
            </Link>
          </>
        }
      />

      <section className="dashboard-stage dashboard-stage--ops">
        <div className="dashboard-stage__hero">
          <h2 className="dashboard-stage__title">Barn floor now</h2>
          <div className="dashboard-stage__chips">
            <Pill tone="blue">{roleWorkspace.label}</Pill>
            <Pill tone={transferGaps.length ? 'rose' : 'emerald'}>{transferGaps.length} transfer gaps</Pill>
            <Pill tone={careDueCount ? 'amber' : 'emerald'}>{careDueCount} care due</Pill>
          </div>
          <div className="dashboard-stage__notes">
            <span>{formatCompactCurrency(budgetSummary.total)} logged this month</span>
            <span>{qualifiedBuyerCount} qualified buyers</span>
            <span>{reviewQueue.length} docs in queue</span>
          </div>
        </div>

        <div className="dashboard-stage__board">
          <MetricCard
            label="Transfer papers"
            value={String(transferGaps.length)}
            tone={transferGaps.length ? 'rose' : 'emerald'}
            onClick={() => navigate('/ownership')}
            title="Open ownership records"
          />
          <MetricCard
            label="Care due"
            value={String(careDueCount)}
            tone={careDueCount ? 'amber' : 'emerald'}
            onClick={() => navigate('/medical')}
            title="Open care board"
          />
          <MetricCard
            label="Monthly spend"
            value={formatCompactCurrency(budgetSummary.total)}
            tone="blue"
            onClick={() => navigate('/')}
            title="Current month operating spend"
          />
        </div>

        <div className="dashboard-stage__aside">
          <div className="dashboard-brand-panel dashboard-brand-panel--ops">
            <div className="dashboard-brand-panel__copy">
              <span>Feed reserve</span>
              <strong>{feedReserveAsset?.name ?? 'No reserve logged'}</strong>
            </div>
            <div className="dashboard-stage__notes">
              <span>{feedReserveAsset?.notes ?? 'Add feed receipts to start supply tracking.'}</span>
              {feedReserveAsset?.nextService ? <span>Service {formatDateLabel(feedReserveAsset.nextService)}</span> : null}
            </div>
          </div>
        </div>
      </section>

      <div className="metric-grid">
        <MetricCard
          label="Review queue"
          value={String(reviewQueue.length)}
          tone={reviewQueue.length ? 'blue' : 'slate'}
          onClick={() => navigate('/documents')}
          title="Documents waiting on review"
        />
        <MetricCard
          label="Coggins watch"
          value={String(cogginsWatchCount)}
          tone={cogginsWatchCount ? 'amber' : 'emerald'}
          onClick={() => navigate('/medical')}
          title="Horses missing or aging coggins"
        />
        <MetricCard
          label="Feed spend"
          value={formatCompactCurrency(budgetSummary.feed)}
          tone="blue"
          onClick={() => navigate('/')}
          title="Feed, bedding, and supplement spend this month"
        />
        <MetricCard
          label="Health spend"
          value={formatCompactCurrency(budgetSummary.health)}
          tone="slate"
          onClick={() => navigate('/')}
          title="Health-related spend this month"
        />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel
          title="Transfer papers"
          meta={<Pill tone={transferGaps.length ? 'rose' : 'emerald'}>{transferGaps.length ? 'Needs action' : 'Clear'}</Pill>}
          action={
            <Link to="/ownership" className="button button--ghost button--compact">
              Ownership
            </Link>
          }
        >
          {transferGaps.length ? (
            <div className="stack-list">
              {transferGaps.slice(0, 6).map((gap) => (
                <button
                  key={gap.horseId}
                  type="button"
                  className="stack-item stack-item--interactive"
                  onClick={() => navigate(`/horses/${gap.horseId}`)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    const record = ownershipRecords.find((item) => item.horseId === gap.horseId);
                    if (record) {
                      setMenuState({ type: 'record', id: record.id, x: event.clientX, y: event.clientY });
                    }
                  }}
                >
                  <div className="stack-item__top">
                    <div className="stack-item__title">{gap.horseName}</div>
                    <Pill tone={gap.transferStatus === 'Clear' ? 'emerald' : 'rose'}>{gap.transferStatus}</Pill>
                  </div>
                  <div className="dashboard-chip-row">
                    {gap.reasons.slice(0, 3).map((reason) => (
                      <Pill key={reason} tone="amber">
                        {reason}
                      </Pill>
                    ))}
                  </div>
                  <div className="inline-metrics">
                    <span>{gap.pendingCount} blockers</span>
                    <span>{gap.dueDate ? `Due ${formatDateLabel(gap.dueDate)}` : 'No deadline'}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState compact title="Transfer packet clear" description="No horses are waiting on transfer papers." />
          )}
        </Panel>

        <Panel
          title="Care board"
          meta={<Pill tone={careDueCount ? 'amber' : 'emerald'}>{careDueCount ? 'Due now' : 'Current'}</Pill>}
          action={
            <Link to="/medical" className="button button--ghost button--compact">
              Medical
            </Link>
          }
        >
          {careBoard.length ? (
            <div className="stack-list">
              {careBoard.slice(0, 6).map((row) => (
                <button
                  key={row.horseId}
                  type="button"
                  className="stack-item stack-item--interactive"
                  onClick={() => navigate(`/horses/${row.horseId}`)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuState({ type: 'horse', id: row.horseId, x: event.clientX, y: event.clientY });
                  }}
                >
                  <div className="stack-item__top">
                    <div className="stack-item__title">{row.horseName}</div>
                    <Pill tone={row.priority >= 4 ? 'rose' : 'amber'}>{row.priority >= 4 ? 'Hot' : 'Watch'}</Pill>
                  </div>
                  <div className="dashboard-chip-row">
                    {row.signals.map((signal) => (
                      <Pill key={signal.key} tone={careSignalTone[signal.status]}>
                        {signal.label} {signal.status === 'clear' ? 'ok' : signal.status}
                      </Pill>
                    ))}
                  </div>
                  <div className="inline-metrics">
                    {row.signals
                      .filter((signal) => signal.status !== 'clear')
                      .slice(0, 2)
                      .map((signal) => (
                        <span key={signal.key}>{signal.detail}</span>
                      ))}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState compact title="Care board clear" description="Wormer, dental, and coggins are current." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel
          title="Budget"
          meta={<Pill tone="blue">{budgetSummary.receiptCount} receipts</Pill>}
          action={
            <button
              type="button"
              className="button button--ghost button--compact"
              onClick={() => document.getElementById('dashboard-receipt-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              Add receipt
            </button>
          }
        >
          <div className="dashboard-budget-strip">
            <div className="ledger-stat">
              <span className="ledger-stat__label">Month</span>
              <strong className="ledger-stat__value">{formatCompactCurrency(budgetSummary.total)}</strong>
            </div>
            <div className="ledger-stat">
              <span className="ledger-stat__label">Feed</span>
              <strong className="ledger-stat__value">{formatCompactCurrency(budgetSummary.feed)}</strong>
            </div>
            <div className="ledger-stat">
              <span className="ledger-stat__label">Health</span>
              <strong className="ledger-stat__value">{formatCompactCurrency(budgetSummary.health)}</strong>
            </div>
          </div>

          {budgetSummary.categories.length ? (
            <div className="stack-list">
              {budgetSummary.categories.slice(0, 4).map((category) => (
                <div key={category.category} className="stack-item">
                  <div className="stack-item__top">
                    <div className="stack-item__title">{category.category}</div>
                    <Pill tone="slate">{formatCurrency(category.amount)}</Pill>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No receipts this month" description="Upload feed and care receipts to start the budget view." />
          )}
        </Panel>

        <Panel
          title="Receipt upload"
          meta={<Pill tone={canManageBudget ? 'blue' : 'slate'}>{canManageBudget ? 'Enabled' : 'Read only'}</Pill>}
        >
          <form id="dashboard-receipt-form" className="dashboard-receipt-form" onSubmit={handleReceiptSubmit}>
            <div className="form-grid form-grid--tight">
              <label className="field-stack">
                <span className="field-label">Category</span>
                <select
                  className="field-input"
                  value={receiptDraft.category}
                  onChange={(event) => setReceiptDraft((current) => ({ ...current, category: event.target.value as ExpenseCategory }))}
                  disabled={!canManageBudget || savingReceipt}
                >
                  {expenseCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-stack">
                <span className="field-label">Horse</span>
                <select
                  className="field-input"
                  value={receiptDraft.horseId}
                  onChange={(event) => setReceiptDraft((current) => ({ ...current, horseId: event.target.value }))}
                  disabled={!canManageBudget || savingReceipt}
                >
                  <option value="">Ranch-wide</option>
                  {horses.map((horse) => (
                    <option key={horse.id} value={horse.id}>
                      {horse.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-stack">
                <span className="field-label">Receipt label</span>
                <input
                  className="field-input"
                  value={receiptDraft.title}
                  onChange={(event) => setReceiptDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Dental float"
                  disabled={!canManageBudget || savingReceipt}
                />
              </label>

              <label className="field-stack">
                <span className="field-label">Vendor</span>
                <input
                  className="field-input"
                  value={receiptDraft.vendor}
                  onChange={(event) => setReceiptDraft((current) => ({ ...current, vendor: event.target.value }))}
                  placeholder="Rolling Plains Vet"
                  disabled={!canManageBudget || savingReceipt}
                />
              </label>

              <label className="field-stack">
                <span className="field-label">Amount</span>
                <input
                  className="field-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={receiptDraft.amount}
                  onChange={(event) => setReceiptDraft((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="240.00"
                  disabled={!canManageBudget || savingReceipt}
                />
              </label>

              <label className="field-stack">
                <span className="field-label">Receipt date</span>
                <input
                  className="field-input"
                  type="date"
                  value={receiptDraft.receiptDate}
                  onChange={(event) => setReceiptDraft((current) => ({ ...current, receiptDate: event.target.value }))}
                  disabled={!canManageBudget || savingReceipt}
                />
              </label>

              <label className="field-stack">
                <span className="field-label">Uploaded by</span>
                <input
                  className="field-input"
                  value={receiptDraft.uploadedBy}
                  onChange={(event) => setReceiptDraft((current) => ({ ...current, uploadedBy: event.target.value }))}
                  disabled={!canManageBudget || savingReceipt}
                />
              </label>

              <label className="field-stack">
                <span className="field-label">Receipt file</span>
                <input
                  className="field-input"
                  type="file"
                  accept=".pdf,image/*"
                  onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
                  disabled={!canManageBudget || savingReceipt}
                />
              </label>

              <label className="field-stack field-stack--wide">
                <span className="field-label">Notes</span>
                <textarea
                  className="field-textarea"
                  value={receiptDraft.notes}
                  onChange={(event) => setReceiptDraft((current) => ({ ...current, notes: event.target.value }))}
                  rows={3}
                  placeholder="Optional note for feed reserve, wormer pack, or dental work."
                  disabled={!canManageBudget || savingReceipt}
                />
              </label>
            </div>

            <div className="inline-actions">
              <button type="submit" className="button button--primary" disabled={!canManageBudget || savingReceipt}>
                {savingReceipt ? 'Logging...' : 'Log receipt'}
              </button>
              {receiptFile ? <Pill tone="slate">{receiptFile.name}</Pill> : null}
            </div>
          </form>
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel
          title="Recent receipts"
          meta={<Pill tone="slate">{budgetSummary.latestReceipts.length} latest</Pill>}
        >
          {budgetSummary.latestReceipts.length ? (
            <div className="stack-list">
              {budgetSummary.latestReceipts.map((receipt) => (
                <button
                  key={receipt.id}
                  type="button"
                  className="stack-item stack-item--interactive"
                  onClick={() => (receipt.horseId ? navigate(`/horses/${receipt.horseId}`) : navigate('/'))}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuState({ type: 'expense', id: receipt.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  <div className="stack-item__top">
                    <div className="stack-item__title">{receipt.title}</div>
                    <Pill tone="blue">{formatCurrency(receipt.amount)}</Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>{receipt.category}</span>
                    <span>{receipt.vendor}</span>
                    <span>{formatDateLabel(receipt.receiptDate)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No receipts logged" description="Budget entries will appear here after upload." />
          )}
        </Panel>

        <Panel
          title="Queue and leads"
          meta={<Pill tone={reviewQueue.length ? 'amber' : 'emerald'}>{reviewQueue.length ? 'Active' : 'Quiet'}</Pill>}
        >
          <div className="stack-list">
            {recentBatches.map((batch) => (
              <Link key={batch.id} to="/documents" className="stack-item stack-item--interactive">
                <div className="stack-item__top">
                  <div className="stack-item__title">{batch.label}</div>
                  <Pill tone={batch.state === 'Completed' ? 'emerald' : batch.state === 'Reviewing' ? 'amber' : 'blue'}>
                    {batch.state}
                  </Pill>
                </div>
                <div className="inline-metrics">
                  <span>{batch.processedCount}/{batch.fileCount} logged</span>
                  <span>{batch.needsReviewCount} review</span>
                </div>
              </Link>
            ))}

            {salesLeads.slice(0, 3).map((lead) => {
              const horse = horses.find((item) => item.id === lead.horseId);
              return (
                <button
                  key={lead.id}
                  type="button"
                  className="stack-item stack-item--interactive"
                  onClick={() => navigate('/sales')}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuState({ type: 'lead', id: lead.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  <div className="stack-item__top">
                    <div className="stack-item__title">{lead.name}</div>
                    <Pill tone={lead.stage === 'Offer' ? 'emerald' : lead.stage === 'Qualified' ? 'blue' : 'amber'}>
                      {lead.stage}
                    </Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>{horse?.name ?? 'Unassigned'}</span>
                    <span>{lead.channel}</span>
                    <span>{formatDateLabel(lead.lastTouch)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}

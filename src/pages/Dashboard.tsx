import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { buildBudgetSummary, buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { formatCompactCurrency, formatCurrency, formatDateLabel } from '@/lib/format';
import { resolveWeatherByQuery, type WeatherForecast } from '@/lib/weather';
import { useCurrentRoleCapability, useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';
import { useUiStore } from '@/store/useUiStore';
import type { ExpenseCategory } from '@/types/xbar';
import { CARE_SIGNAL_TONE, EXPENSE_CATEGORIES } from '@/features/dashboard/constants';
import type { DashboardMenuState } from '@/features/dashboard/types';

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
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const addExpenseReceipt = useXbarStore((state) => state.addExpenseReceipt);
  const roleWorkspace = useCurrentRoleWorkspace();
  const canManageBudget = useCurrentRoleCapability('manageAssets');
  const [menuState, setMenuState] = useState<DashboardMenuState | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [weather, setWeather] = useState<WeatherForecast | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
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
  const urgencyCount = transferGaps.length + careDueCount + reviewQueue.length;
  const nextMove = transferGaps.length
    ? 'Resolve title and transfer blockers'
    : careDueCount
      ? 'Clear the care holds'
      : reviewQueue.length
        ? 'Approve proof waiting in the vault'
        : qualifiedBuyerCount
          ? 'Move qualified buyers forward'
          : 'Prepare the next buyer-ready horse record';
  const nextMovePath = transferGaps.length
    ? '/ownership'
    : careDueCount
      ? '/medical'
      : reviewQueue.length
        ? '/documents'
        : qualifiedBuyerCount
          ? '/sales'
          : '/horses';

  useEffect(() => {
    const ranchQuery = workspaceProfile.ranchName.trim();
    if (!ranchQuery) {
      setWeather(null);
      setWeatherError('Set the ranch location in Settings.');
      return;
    }

    let cancelled = false;
    setWeatherLoading(true);
    setWeatherError(null);

    void resolveWeatherByQuery(ranchQuery)
      .then((forecast) => {
        if (!cancelled) setWeather(forecast);
      })
      .catch((error) => {
        if (!cancelled) {
          setWeather(null);
          setWeatherError(error instanceof Error ? error.message : 'Field conditions could not load.');
        }
      })
      .finally(() => {
        if (!cancelled) setWeatherLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceProfile.ranchName]);

  const menuHorse = menuState?.type === 'horse' ? horses.find((horse) => horse.id === menuState.id) : undefined;
  const menuRecord = menuState?.type === 'record' ? ownershipRecords.find((record) => record.id === menuState.id) : undefined;
  const menuLead = menuState?.type === 'lead' ? salesLeads.find((lead) => lead.id === menuState.id) : undefined;
  const menuExpense = menuState?.type === 'expense' ? expenseReceipts.find((receipt) => receipt.id === menuState.id) : undefined;
  const menuRecordHorse = horses.find((horse) => horse.id === menuRecord?.horseId);
  const menuLeadHorse = horses.find((horse) => horse.id === menuLead?.horseId);
  const menuExpenseHorse = horses.find((horse) => horse.id === menuExpense?.horseId);
  const menuItems = menuHorse
    ? [
        { id: 'open-horse', label: 'Open horse record', onSelect: () => navigate(`/horses/${menuHorse.id}`) },
        { id: 'open-profile', label: 'Open buyer packet', onSelect: () => navigate(`/profiles/${menuHorse.id}`) },
      ]
    : menuRecord
      ? [
          { id: 'open-ownership', label: 'Open title & transfer', onSelect: () => navigate('/ownership') },
          ...(menuRecordHorse ? [{ id: 'open-record-horse', label: 'Open horse record', onSelect: () => navigate(`/horses/${menuRecordHorse.id}`) }] : []),
        ]
      : menuLead
        ? [
            { id: 'open-sales', label: 'Open buyer desk', onSelect: () => navigate('/sales') },
            ...(menuLeadHorse ? [{ id: 'open-lead-horse', label: 'Open horse record', onSelect: () => navigate(`/horses/${menuLeadHorse.id}`) }] : []),
          ]
        : menuExpense
          ? [
              { id: 'open-ledger', label: 'Open operating ledger', onSelect: () => navigate('/expenses') },
              ...(menuExpenseHorse ? [{ id: 'open-expense-horse', label: 'Open horse record', onSelect: () => navigate(`/horses/${menuExpenseHorse.id}`) }] : []),
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
      setReceiptDraft((current) => ({ ...current, horseId: '', title: '', vendor: '', amount: '', notes: '' }));
      setReceiptFile(null);
    }
    setSavingReceipt(false);
  }

  if (!hasWorkspaceData) {
    return (
      <>
        <div className="ops-briefing-header command-center-briefing">
          <div className="ops-briefing-header__top">
            <div className="ops-briefing-header__left">
              <div className="ops-briefing-header__ranch">Your barn</div>
              <h1 className="ops-briefing-header__title">Add your first horse.</h1>
              <p className="command-center-briefing__copy">
                Create a record for your first horse and upload its papers. XBAR keeps health, ownership, buyers, weather, and costs organized around it.
              </p>
              <div className="ops-briefing-header__chips">
                <span className="ops-briefing-chip">Horse records</span>
                <span className="ops-briefing-chip">Papers</span>
                <span className="ops-briefing-chip">Costs</span>
                <span className="ops-briefing-chip">Weather</span>
              </div>
            </div>
            <div className="ops-briefing-header__actions">
              <Link to="/horses?new=1" className="ops-briefing-action ops-briefing-action--primary">Add a horse</Link>
              <Link to="/documents?upload=1" className="ops-briefing-action">Upload papers</Link>
              <Link to="/settings" className="ops-briefing-action">Settings</Link>
            </div>
          </div>
          <div className="ops-briefing-stat-row">
            <div className="ops-briefing-stat"><span className="ops-briefing-stat__label">Horses</span><span className="ops-briefing-stat__value ops-briefing-stat__value--clear">0</span><span className="ops-briefing-stat__detail">none yet</span></div>
            <div className="ops-briefing-stat"><span className="ops-briefing-stat__label">Papers</span><span className="ops-briefing-stat__value">0</span><span className="ops-briefing-stat__detail">none uploaded</span></div>
            <div className="ops-briefing-stat"><span className="ops-briefing-stat__label">Transfers</span><span className="ops-briefing-stat__value ops-briefing-stat__value--clear">0</span><span className="ops-briefing-stat__detail">none pending</span></div>
            <div className="ops-briefing-stat"><span className="ops-briefing-stat__label">Buyers</span><span className="ops-briefing-stat__value">0</span><span className="ops-briefing-stat__detail">no activity yet</span></div>
          </div>
        </div>

        <div className="dashboard-grid dashboard-grid--primary">
          <Panel eyebrow="First move" title="Create the first horse record">
            <EmptyState
              title="No horse records yet"
              description="Add the first horse, then attach proof. The system becomes useful when every decision points back to a file."
              action={
                <div className="inline-actions">
                  <Link to="/horses?new=1" className="button button--primary button--compact">Create file</Link>
                  <Link to="/documents?upload=1" className="button button--ghost button--compact">Upload proof</Link>
                  <Link to="/weather" className="button button--ghost button--compact">Field conditions</Link>
                </div>
              }
            />
          </Panel>

          <Panel eyebrow="Operating sequence" title="What to build first">
            <div className="stack-list">
              <div className="stack-item"><div className="stack-item__title">Horse record</div><div className="stack-item__copy">One horse gives the system something to organize around: identity, barn, owner, and status.</div></div>
              <div className="stack-item"><div className="stack-item__title">Proof vault</div><div className="stack-item__copy">Upload Coggins, registration, health papers, contracts, and receipts so gaps are visible.</div></div>
              <div className="stack-item"><div className="stack-item__title">Operating ledger</div><div className="stack-item__copy">Log feed, wormer, dental, and vet costs while context is fresh.</div></div>
              <div className="stack-item"><div className="stack-item__title">Field conditions</div><div className="stack-item__copy">Set ranch location and use weather for turnout, hauling, and breeding windows.</div></div>
            </div>
          </Panel>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="ops-briefing-header command-center-briefing">
        <div className="ops-briefing-header__top">
          <div className="ops-briefing-header__left">
            <div className="ops-briefing-header__ranch">{workspaceProfile.ranchName || workspaceProfile.businessName || 'Ranch Operations'} · {roleWorkspace.label}</div>
            <h1 className="ops-briefing-header__title">
              {urgencyCount > 0
                ? `${urgencyCount} control point${urgencyCount === 1 ? '' : 's'} need a decision.`
                : 'Ranch command is clear.'}
            </h1>
            <p className="command-center-briefing__copy">
              Private command view for horse files, proof, care, ownership, buyers, field conditions, and operating cost.
            </p>
            <div className="ops-briefing-header__chips">
              <span className="ops-briefing-chip">{roleWorkspace.label}</span>
              <span className={transferGaps.length ? 'ops-briefing-chip ops-briefing-chip--urgent' : 'ops-briefing-chip ops-briefing-chip--success'}>
                {transferGaps.length} transfer{transferGaps.length !== 1 ? 's' : ''} pending
              </span>
              <span className={careDueCount ? 'ops-briefing-chip ops-briefing-chip--warning' : 'ops-briefing-chip ops-briefing-chip--success'}>
                {careDueCount} care due
              </span>
              {weather ? <span className="ops-briefing-chip">{weather.current.temperatureF}°F · {weather.current.weatherLabel}</span> : null}
            </div>
          </div>
          <div className="ops-briefing-header__actions">
            <button type="button" className="ops-briefing-action ops-briefing-action--primary" onClick={() => navigate(nextMovePath)}>Open next move</button>
            <Link to="/documents" className="ops-briefing-action">Documents</Link>
            <Link to="/weather" className="ops-briefing-action">Weather</Link>
          </div>
        </div>
        <div className="command-center-next-move">
          <span>Highest-value move</span>
          <strong>{nextMove}</strong>
          <em>{urgencyCount > 0 ? 'XBAR is surfacing the first visible blocker.' : 'Use the clear window to strengthen buyer readiness or documents.'}</em>
        </div>
        <div className="ops-briefing-stat-row">
          <button type="button" className="ops-briefing-stat ops-briefing-stat--clickable" onClick={() => navigate('/ownership')} title="Open title and transfer">
            <span className="ops-briefing-stat__label">Proof gaps</span>
            <span className={`ops-briefing-stat__value${transferGaps.length ? ' ops-briefing-stat__value--urgent' : ' ops-briefing-stat__value--clear'}`}>{transferGaps.length}</span>
            <span className="ops-briefing-stat__detail">{transferGaps.length ? 'need resolution' : 'all clear'}</span>
          </button>
          <button type="button" className="ops-briefing-stat ops-briefing-stat--clickable" onClick={() => navigate('/medical')} title="Open care status">
            <span className="ops-briefing-stat__label">Care holds</span>
            <span className={`ops-briefing-stat__value${careDueCount ? ' ops-briefing-stat__value--warning' : ' ops-briefing-stat__value--clear'}`}>{careDueCount}</span>
            <span className="ops-briefing-stat__detail">{careDueCount ? 'horses overdue' : 'care current'}</span>
          </button>
          <button type="button" className="ops-briefing-stat ops-briefing-stat--clickable" onClick={() => navigate('/documents')} title="Documents waiting on review">
            <span className="ops-briefing-stat__label">Proof queue</span>
            <span className={`ops-briefing-stat__value${reviewQueue.length ? ' ops-briefing-stat__value--warning' : ''}`}>{reviewQueue.length}</span>
            <span className="ops-briefing-stat__detail">{reviewQueue.length ? 'waiting review' : 'queue clear'}</span>
          </button>
          <button type="button" className="ops-briefing-stat ops-briefing-stat--clickable" onClick={() => navigate('/expenses')} title="Open operating ledger">
            <span className="ops-briefing-stat__label">Month spend</span>
            <span className="ops-briefing-stat__value">{formatCompactCurrency(budgetSummary.total)}</span>
            <span className="ops-briefing-stat__detail">{qualifiedBuyerCount} qualified buyer{qualifiedBuyerCount !== 1 ? 's' : ''}</span>
          </button>
        </div>
      </div>

      <section className="command-stage command-stage--two-col command-center-stage">
        <div className="command-stage__rail">
          <MetricCard label="Proof gaps" value={String(transferGaps.length + reviewQueue.length)} tone={transferGaps.length ? 'rose' : reviewQueue.length ? 'amber' : 'emerald'} onClick={() => navigate(transferGaps.length ? '/ownership' : '/documents')} title="Open proof controls" />
          <MetricCard label="Care holds" value={String(careDueCount)} tone={careDueCount ? 'amber' : 'emerald'} onClick={() => navigate('/medical')} title="Open care status" />
          <MetricCard label="Operating spend" value={formatCompactCurrency(budgetSummary.total)} tone="blue" onClick={() => navigate('/expenses')} title="Open operating ledger" />
        </div>

        <div className="command-stage__support">
          <div className="command-stage__support-card">
            <div className="command-stage__support-label">Feed room</div>
            <strong className="command-stage__support-title">{feedReserveAsset?.name ?? 'Not logged'}</strong>
            <div className="command-stage__support-copy">
              <span>{feedReserveAsset?.notes ?? 'Add feed receipts to start reserve tracking.'}</span>
              {feedReserveAsset?.nextService ? <span>Service {formatDateLabel(feedReserveAsset.nextService)}</span> : <span>No service date</span>}
            </div>
          </div>
          <div className="command-stage__support-card">
            <div className="command-stage__support-label">Proof intake</div>
            <strong className="command-stage__support-title">{recentBatches[0]?.label ?? 'No batch yet'}</strong>
            <div className="command-stage__support-copy">
              <span>{recentBatches[0] ? `${recentBatches[0].processedCount}/${recentBatches[0].fileCount} logged` : 'Upload the first packet.'}</span>
              <span>{reviewQueue.length} waiting on review</span>
            </div>
          </div>
          <div className="command-stage__support-card">
            <div className="command-stage__support-label">Field conditions</div>
            <strong className="command-stage__support-title">{weatherLoading ? 'Loading...' : weather ? `${weather.current.temperatureF}°F · ${weather.current.weatherLabel}` : 'Forecast offline'}</strong>
            <div className="command-stage__support-copy">
              <span>{weather ? `${weather.today.rainChance}% rain · ${weather.current.windMph} mph wind · UV ${weather.today.uvIndex}` : weatherError || 'Open Weather and set the ranch location.'}</span>
              <span>{weather ? weather.notes.turnout : 'Use weather to plan turnout, hauling, and breeding work.'}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="metric-grid metric-grid--dashboard">
        <MetricCard label="Proof queue" value={String(reviewQueue.length)} tone={reviewQueue.length ? 'blue' : 'slate'} onClick={() => navigate('/documents')} title="Proof files waiting on review" />
        <MetricCard label="Coggins watch" value={String(cogginsWatchCount)} tone={cogginsWatchCount ? 'amber' : 'emerald'} onClick={() => navigate('/medical')} title="Horses missing or aging Coggins" />
        <MetricCard label="Feed spend" value={formatCompactCurrency(budgetSummary.feed)} tone="blue" onClick={() => navigate('/expenses')} title="Feed, bedding, and supplement spend this month" />
        <MetricCard label="Health spend" value={formatCompactCurrency(budgetSummary.health)} tone="slate" onClick={() => navigate('/expenses')} title="Health-related spend this month" />
      </div>

      <div className="dashboard-board">
        <div className="dashboard-board__main">
          <Panel title="Title & transfer holds" meta={<Pill tone={transferGaps.length ? 'rose' : 'emerald'}>{transferGaps.length ? 'Action required' : 'Clear'}</Pill>} surfaceId="command-transfer-issues" style={{ order: transferGaps.length ? 0 : 2 }} action={<Link to="/ownership" className="button button--ghost button--compact">Ownership</Link>}>
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
                      if (record) setMenuState({ type: 'record', id: record.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <div className="stack-item__top"><div className="stack-item__title">{gap.horseName}</div><Pill tone={gap.transferStatus === 'Clear' ? 'emerald' : 'rose'}>{gap.transferStatus}</Pill></div>
                    <div className="dashboard-chip-row">{gap.reasons.slice(0, 3).map((reason) => <Pill key={reason} tone="amber">{reason}</Pill>)}</div>
                    <div className="inline-metrics"><span>{gap.pendingCount} blockers</span><span>{gap.dueDate ? `Due ${formatDateLabel(gap.dueDate)}` : 'No deadline'}</span></div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState compact title="Transfer proof clear" description="No horse records are waiting on transfer papers." />
            )}
          </Panel>

          <Panel title="Care holds" meta={<Pill tone={careDueCount ? 'amber' : 'emerald'}>{careDueCount ? 'Due now' : 'Current'}</Pill>} surfaceId="command-care-board" style={{ order: careDueCount ? 0 : 2 }} action={<div className="inline-actions"><Link to="/weather" className="button button--ghost button--compact">Weather</Link><Link to="/medical" className="button button--ghost button--compact">Health</Link></div>}>
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
                    <div className="stack-item__top"><div className="stack-item__title">{row.horseName}</div><Pill tone={row.priority >= 4 ? 'rose' : 'amber'}>{row.priority >= 4 ? 'Hot' : 'Watch'}</Pill></div>
                    <div className="dashboard-chip-row">{row.signals.map((signal) => <Pill key={signal.key} tone={CARE_SIGNAL_TONE[signal.status]}>{signal.label} {signal.status === 'clear' ? 'ok' : signal.status}</Pill>)}</div>
                    <div className="inline-metrics">
                      {row.signals.filter((signal) => signal.status !== 'clear').slice(0, 2).map((signal) => <span key={signal.key}>{signal.detail}</span>)}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState compact title="No care holds" description="Care status appears once horse records and proof records exist." />
            )}
          </Panel>
        </div>

        <div className="dashboard-board__side">
          <Panel title="Operating ledger" meta={<Pill tone="blue">{budgetSummary.receiptCount} receipts</Pill>} surfaceId="command-budget" action={<button type="button" className="button button--ghost button--compact" onClick={() => document.getElementById('dashboard-receipt-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Add receipt</button>}>
            <div className="dashboard-budget-strip">
              <div className="ledger-stat"><span className="ledger-stat__label">Month</span><strong className="ledger-stat__value">{formatCompactCurrency(budgetSummary.total)}</strong></div>
              <div className="ledger-stat"><span className="ledger-stat__label">Feed</span><strong className="ledger-stat__value">{formatCompactCurrency(budgetSummary.feed)}</strong></div>
              <div className="ledger-stat"><span className="ledger-stat__label">Health</span><strong className="ledger-stat__value">{formatCompactCurrency(budgetSummary.health)}</strong></div>
            </div>
            {budgetSummary.categories.length ? (
              <div className="stack-list">
                {budgetSummary.categories.slice(0, 4).map((category) => (
                  <div key={category.category} className="stack-item"><div className="stack-item__top"><div className="stack-item__title">{category.category}</div><Pill tone="slate">{formatCurrency(category.amount)}</Pill></div></div>
                ))}
              </div>
            ) : (
              <EmptyState compact title="No receipts this month" description="Upload feed and care receipts to start the ledger view." />
            )}
          </Panel>

          <Panel title="Proof queue" meta={<Pill tone={reviewQueue.length ? 'amber' : 'emerald'}>{reviewQueue.length ? 'Active' : 'Clear'}</Pill>} surfaceId="command-work-queue" action={<Link to="/documents" className="button button--ghost button--compact">Documents</Link>}>
            <div className="stack-list">
              {reviewQueue.slice(0, 5).map((document) => (
                <Link key={document.id} to="/documents" className="stack-item stack-item--interactive">
                  <div className="stack-item__top"><div className="stack-item__title">{document.title}</div><Pill tone="amber">{document.state}</Pill></div>
                  <div className="inline-metrics"><span>{document.type}</span><span>{formatDateLabel(document.uploadedAt)}</span></div>
                </Link>
              ))}
              {recentBatches.map((batch) => (
                <Link key={batch.id} to="/documents" className="stack-item stack-item--interactive">
                  <div className="stack-item__top"><div className="stack-item__title">{batch.label}</div><Pill tone={batch.state === 'Completed' ? 'emerald' : batch.state === 'Reviewing' ? 'amber' : 'blue'}>{batch.state}</Pill></div>
                  <div className="inline-metrics"><span>{batch.processedCount}/{batch.fileCount} logged</span><span>{batch.needsReviewCount} review</span></div>
                </Link>
              ))}
              {!reviewQueue.length && !recentBatches.length ? <EmptyState compact title="Proof queue clear" description="No documents are waiting on review." /> : null}
            </div>
          </Panel>
        </div>
      </div>

      <div className="dashboard-board dashboard-board--lower">
        <Panel title="Log receipt" meta={<Pill tone={canManageBudget ? 'blue' : 'slate'}>{canManageBudget ? 'Enabled' : 'Read only'}</Pill>} surfaceId="command-receipt-intake">
          <form id="dashboard-receipt-form" className="dashboard-receipt-form" onSubmit={handleReceiptSubmit}>
            <div className="form-grid form-grid--tight">
              <label className="field-stack"><span className="field-label">Category</span><select className="field-input" value={receiptDraft.category} onChange={(event) => setReceiptDraft((current) => ({ ...current, category: event.target.value as ExpenseCategory }))} disabled={!canManageBudget || savingReceipt}>{EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
              <label className="field-stack"><span className="field-label">Horse record</span><select className="field-input" value={receiptDraft.horseId} onChange={(event) => setReceiptDraft((current) => ({ ...current, horseId: event.target.value }))} disabled={!canManageBudget || savingReceipt}><option value="">Ranch-wide</option>{horses.map((horse) => <option key={horse.id} value={horse.id}>{horse.name}</option>)}</select></label>
              <label className="field-stack"><span className="field-label">Receipt label</span><input className="field-input" value={receiptDraft.title} onChange={(event) => setReceiptDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Dental float" disabled={!canManageBudget || savingReceipt} /></label>
              <label className="field-stack"><span className="field-label">Vendor</span><input className="field-input" value={receiptDraft.vendor} onChange={(event) => setReceiptDraft((current) => ({ ...current, vendor: event.target.value }))} placeholder="Rolling Plains Vet" disabled={!canManageBudget || savingReceipt} /></label>
              <label className="field-stack"><span className="field-label">Amount</span><input className="field-input" type="number" min="0" step="0.01" value={receiptDraft.amount} onChange={(event) => setReceiptDraft((current) => ({ ...current, amount: event.target.value }))} placeholder="240.00" disabled={!canManageBudget || savingReceipt} /></label>
              <label className="field-stack"><span className="field-label">Receipt date</span><input className="field-input" type="date" value={receiptDraft.receiptDate} onChange={(event) => setReceiptDraft((current) => ({ ...current, receiptDate: event.target.value }))} disabled={!canManageBudget || savingReceipt} /></label>
              <label className="field-stack"><span className="field-label">Uploaded by</span><input className="field-input" value={receiptDraft.uploadedBy} onChange={(event) => setReceiptDraft((current) => ({ ...current, uploadedBy: event.target.value }))} disabled={!canManageBudget || savingReceipt} /></label>
              <label className="field-stack"><span className="field-label">Receipt file</span><input className="field-input" type="file" accept=".pdf,image/*" onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)} disabled={!canManageBudget || savingReceipt} /></label>
              <label className="field-stack field-stack--wide"><span className="field-label">Notes</span><textarea className="field-textarea" value={receiptDraft.notes} onChange={(event) => setReceiptDraft((current) => ({ ...current, notes: event.target.value }))} rows={3} placeholder="Optional note for feed reserve, wormer pack, or dental work." disabled={!canManageBudget || savingReceipt} /></label>
            </div>
            <div className="inline-actions">
              <button type="submit" className="button button--primary" disabled={!canManageBudget || savingReceipt}>{savingReceipt ? 'Logging...' : 'Log receipt'}</button>
              {receiptFile ? <Pill tone="slate">{receiptFile.name}</Pill> : null}
            </div>
          </form>
        </Panel>

        <Panel title="Buyer desk" meta={<Pill tone={salesLeads.length ? 'blue' : 'slate'}>{salesLeads.length ? 'Active' : 'Quiet'}</Pill>} surfaceId="command-buyer-desk" action={<Link to="/sales" className="button button--ghost button--compact">Sales</Link>}>
          {salesLeads.length ? (
            <div className="stack-list">
              {salesLeads.slice(0, 5).map((lead) => {
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
                    <div className="stack-item__top"><div className="stack-item__title">{lead.name}</div><Pill tone={lead.stage === 'Offer' ? 'emerald' : lead.stage === 'Qualified' ? 'blue' : 'amber'}>{lead.stage}</Pill></div>
                    <div className="inline-metrics"><span>{horse?.name ?? 'Unassigned'}</span><span>{lead.channel}</span><span>{formatDateLabel(lead.lastTouch)}</span></div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No buyer movement" description="Buyer activity appears here once leads are attached to horse records." />
          )}
        </Panel>
      </div>

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}

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

  useEffect(() => {
    const ranchQuery = workspaceProfile.ranchName.trim();
    if (!ranchQuery) {
      setWeather(null);
      setWeatherError('Set the ranch location in Ranch Control.');
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
        { id: 'open-horse', label: 'Open command file', onSelect: () => navigate(`/horses/${menuHorse.id}`) },
        { id: 'open-profile', label: 'Open buyer packet', onSelect: () => navigate(`/profiles/${menuHorse.id}`) },
      ]
    : menuRecord
      ? [
          { id: 'open-ownership', label: 'Open title & transfer', onSelect: () => navigate('/ownership') },
          ...(menuRecordHorse ? [{ id: 'open-record-horse', label: 'Open command file', onSelect: () => navigate(`/horses/${menuRecordHorse.id}`) }] : []),
        ]
      : menuLead
        ? [
            { id: 'open-sales', label: 'Open buyer desk', onSelect: () => navigate('/sales') },
            ...(menuLeadHorse ? [{ id: 'open-lead-horse', label: 'Open command file', onSelect: () => navigate(`/horses/${menuLeadHorse.id}`) }] : []),
          ]
        : menuExpense
          ? [
              { id: 'open-ledger', label: 'Open operating ledger', onSelect: () => navigate('/expenses') },
              ...(menuExpenseHorse ? [{ id: 'open-expense-horse', label: 'Open command file', onSelect: () => navigate(`/horses/${menuExpenseHorse.id}`) }] : []),
            ]
          : [];

  const hasWorkspaceData = Boolean(horses.length || documents.length || ownershipRecords.length || expenseReceipts.length || salesLeads.length || intakeBatches.length || ranchAssets.length);

  if (!hasWorkspaceData) {
    return (
      <>
        <div className="ops-briefing-header command-center-briefing">
          <div className="ops-briefing-header__top">
            <div className="ops-briefing-header__left">
              <div className="ops-briefing-header__ranch">Local command workspace</div>
              <h1 className="ops-briefing-header__title">Stand up the ranch command system.</h1>
              <p className="command-center-briefing__copy">Private local workspace for horse files, proof, care, ownership, buyers, and operating cost. Cloud sync can come later.</p>
              <div className="ops-briefing-header__chips">
                <span className="ops-briefing-chip">Horse command file</span>
                <span className="ops-briefing-chip">Proof vault</span>
                <span className="ops-briefing-chip">Operating ledger</span>
                <span className="ops-briefing-chip">Field conditions</span>
              </div>
            </div>
            <div className="ops-briefing-header__actions">
              <Link to="/horses?new=1" className="ops-briefing-action ops-briefing-action--primary">Create command file</Link>
              <Link to="/documents?upload=1" className="ops-briefing-action">Upload proof</Link>
              <Link to="/settings" className="ops-briefing-action">Ranch Control</Link>
            </div>
          </div>
          <div className="ops-briefing-stat-row">
            <div className="ops-briefing-stat"><span className="ops-briefing-stat__label">Files</span><span className="ops-briefing-stat__value ops-briefing-stat__value--clear">0</span><span className="ops-briefing-stat__detail">no command files</span></div>
            <div className="ops-briefing-stat"><span className="ops-briefing-stat__label">Proof</span><span className="ops-briefing-stat__value">0</span><span className="ops-briefing-stat__detail">vault empty</span></div>
            <div className="ops-briefing-stat"><span className="ops-briefing-stat__label">Transfers</span><span className="ops-briefing-stat__value ops-briefing-stat__value--clear">0</span><span className="ops-briefing-stat__detail">none pending</span></div>
            <div className="ops-briefing-stat"><span className="ops-briefing-stat__label">Buyers</span><span className="ops-briefing-stat__value">0</span><span className="ops-briefing-stat__detail">no movement</span></div>
          </div>
        </div>

        <div className="dashboard-grid dashboard-grid--primary">
          <Panel eyebrow="First move" title="Create the first command file">
            <EmptyState
              title="No command files yet"
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
              <div className="stack-item"><div className="stack-item__title">Horse command file</div><div className="stack-item__copy">One horse gives the system something to organize around: identity, barn, owner, and status.</div></div>
              <div className="stack-item"><div className="stack-item__title">Proof vault</div><div className="stack-item__copy">Upload Coggins, registration, health papers, contracts, and receipts so gaps are visible.</div></div>
              <div className="stack-item"><div className="stack-item__title">Operating ledger</div><div className="stack-item__copy">Log feed, wormer, dental, and vet costs while context is fresh.</div></div>
              <div className="stack-item"><div className="stack-item__title">Field conditions</div><div className="stack-item__copy">Set ranch location and use weather for turnout, hauling, and breeding windows.</div></div>
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
    pushToast({ title: result.ok ? 'Receipt logged' : 'Receipt blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok) {
      setReceiptDraft((current) => ({ ...current, horseId: '', title: '', vendor: '', amount: '', notes: '' }));
      setReceiptFile(null);
    }
    setSavingReceipt(false);
  }

  const urgencyCount = transferGaps.length + careDueCount + reviewQueue.length;
  const nextMove = transferGaps.length ? 'Resolve title and transfer blockers' : careDueCount ? 'Clear the care holds' : reviewQueue.length ? 'Approve proof waiting in the vault' : 'Prepare the next buyer-ready packet';
  const nextMovePath = transferGaps.length ? '/ownership' : careDueCount ? '/medical' : reviewQueue.length ? '/documents' : '/shared-access';

  return (
    <>
      <div className="ops-briefing-header command-center-briefing">
        <div className="ops-briefing-header__top">
          <div className="ops-briefing-header__left">
            <div className="ops-briefing-header__ranch">{workspaceProfile.ranchName || workspaceProfile.businessName || 'Ranch Operations'} · {roleWorkspace.label}</div>
            <h1 className="ops-briefing-header__title">{urgencyCount > 0 ? `${urgencyCount} control point${urgencyCount === 1 ? '' : 's'} need a decision.` : 'Ranch command is clear.'}</h1>
            <p className="command-center-briefing__copy">Private local command system for horse files, proof, care, ownership, buyers, field conditions, and operating cost.</p>
            <div className="ops-briefing-header__chips">
              <span className="ops-briefing-chip">Local browser workspace</span>
              <span className={transferGaps.length ? 'ops-briefing-chip ops-briefing-chip--urgent' : 'ops-briefing-chip ops-briefing-chip--success'}>{transferGaps.length} transfer{transferGaps.length !== 1 ? 's' : ''} pending</span>
              <span className={careDueCount ? 'ops-briefing-chip ops-briefing-chip--warning' : 'ops-briefing-chip ops-briefing-chip--success'}>{careDueCount} care due</span>
              {weather ? <span className="ops-briefing-chip">{weather.current.temperatureF}°F · {weather.current.weatherLabel}</span> : null}
            </div>
          </div>
          <div className="ops-briefing-header__actions">
            <button type="button" className="ops-briefing-action ops-briefing-action--primary" onClick={() => navigate(nextMovePath)}>Open next move</button>
            <Link to="/documents" className="ops-briefing-action">Proof Vault</Link>
            <Link to="/weather" className="ops-briefing-action">Field Conditions</Link>
          </div>
        </div>
        <div className="command-center-next-move">
          <span>Highest-value move</span>
          <strong>{nextMove}</strong>
          <em>{urgencyCount > 0 ? 'XBAR is surfacing the first visible blocker.' : 'Use the clear window to strengthen buyer readiness or proof files.'}</em>
        </div>
        <div className="ops-briefing-stat-row">
          <button type="button" className="ops-briefing-stat ops-briefing-stat--clickable" onClick={() => navigate('/ownership')} title="Open title and transfer"><span className="ops-briefing-stat__label">Proof gaps</span><span className={`ops-briefing-stat__value${transferGaps.length ? ' ops-briefing-stat__value--urgent' : ' ops-briefing-stat__value--clear'}`}>{transferGaps.length}</span><span className="ops-briefing-stat__detail">{transferGaps.length ? 'need resolution' : 'all clear'}</span></button>
          <button type="button" className="ops-briefing-stat ops-briefing-stat--clickable" onClick={() => navigate('/medical')} title="Open care status"><span className="ops-briefing-stat__label">Care holds</span><span className={`ops-briefing-stat__value${careDueCount ? ' ops-briefing-stat__value--warning' : ' ops-briefing-stat__value--clear'}`}>{careDueCount}</span><span className="ops-briefing-stat__detail">{careDueCount ? 'horses overdue' : 'care current'}</span></button>
          <button type="button" className="ops-briefing-stat ops-briefing-stat--clickable" onClick={() => navigate('/documents')} title="Documents waiting on review"><span className="ops-briefing-stat__label">Proof queue</span><span className={`ops-briefing-stat__value${reviewQueue.length ? ' ops-briefing-stat__value--warning' : ''}`}>{reviewQueue.length}</span><span className="ops-briefing-stat__detail">{reviewQueue.length ? 'waiting review' : 'queue clear'}</span></button>
          <button type="button" className="ops-briefing-stat ops-briefing-stat--clickable" onClick={() => navigate('/expenses')} title="Open operating ledger"><span className="ops-briefing-stat__label">Month spend</span><span className="ops-briefing-stat__value">{formatCompactCurrency(budgetSummary.total)}</span><span className="ops-briefing-stat__detail">{qualifiedBuyerCount} qualified buyer{qualifiedBuyerCount !== 1 ? 's' : ''}</span></button>
        </div>
      </div>

      <section className="command-stage command-stage--two-col command-center-stage">
        <div className="command-stage__rail">
          <MetricCard label="Proof gaps" value={String(transferGaps.length + reviewQueue.length)} tone={transferGaps.length ? 'rose' : reviewQueue.length ? 'amber' : 'emerald'} onClick={() => navigate(transferGaps.length ? '/ownership' : '/documents')} title="Open proof controls" />
          <MetricCard label="Care holds" value={String(careDueCount)} tone={careDueCount ? 'amber' : 'emerald'} onClick={() => navigate('/medical')} title="Open care status" />
          <MetricCard label="Operating spend" value={formatCompactCurrency(budgetSummary.total)} tone="blue" onClick={() => navigate('/expenses')} title="Open operating ledger" />
        </div>
        <div className="command-stage__support">
          <div className="command-stage__support-card"><div className="command-stage__support-label">Feed room</div><strong className="command-stage__support-title">{feedReserveAsset?.name ?? 'Not logged'}</strong><div className="command-stage__support-copy"><span>{feedReserveAsset?.notes ?? 'Add feed receipts to start reserve tracking.'}</span>{feedReserveAsset?.nextService ? <span>Service {formatDateLabel(feedReserveAsset.nextService)}</span> : <span>No service date</span>}</div></div>
          <div className="command-stage__support-card"><div className="command-stage__support-label">Proof intake</div><strong className="command-stage__support-title">{recentBatches[0]?.label ?? 'No batch yet'}</strong><div className="command-stage__support-copy"><span>{recentBatches[0] ? `${recentBatches[0].processedCount}/${recentBatches[0].fileCount} logged` : 'Upload the first packet.'}</span><span>{reviewQueue.length} waiting on review</span></div></div>
          <div className="command-stage__support-card"><div className="command-stage__support-label">Field conditions</div><strong className="command-stage__support-title">{weatherLoading ? 'Loading...' : weather ? `${weather.current.temperatureF}°F · ${weather.current.weatherLabel}` : 'Forecast offline'}</strong><div className="command-stage__support-copy"><span>{weather ? `${weather.today.rainChance}% rain · ${weather.current.windMph} mph wind · UV ${weather.today.uvIndex}` : weatherError || 'Open Field Conditions and set the ranch location.'}</span><span>{weather ? weather.notes.turnout : 'Use weather to plan turnout, hauling, and breeding work.'}</span></div></div>
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
          <Panel title="Title & transfer holds" meta={<Pill tone={transferGaps.length ? 'rose' : 'emerald'}>{transferGaps.length ? 'Action required' : 'Clear'}</Pill>} surfaceId="command-transfer-issues" style={{ order: transferGaps.length ? 0 : 2 }} action={<Link to="/ownership" className="button button--ghost button--compact">Title & Transfer</Link>}>
            {transferGaps.length ? <div className="stack-list">{transferGaps.slice(0, 6).map((gap) => <button key={gap.horseId} type="button" className="stack-item stack-item--interactive" onClick={() => navigate(`/horses/${gap.horseId}`)} onContextMenu={(event) => { event.preventDefault(); const record = ownershipRecords.find((item) => item.horseId === gap.horseId); if (record) setMenuState({ type: 'record', id: record.id, x: event.clientX, y: event.clientY }); }}><div className="stack-item__top"><div className="stack-item__title">{gap.horseName}</div><Pill tone={gap.transferStatus === 'Clear' ? 'emerald' : 'rose'}>{gap.transferStatus}</Pill></div><div className="dashboard-chip-row">{gap.reasons.slice(0, 3).map((reason) => <Pill key={reason} tone="amber">{reason}</Pill>)}</div><div className="inline-metrics"><span>{gap.pendingCount} blockers</span><span>{gap.dueDate ? `Due ${formatDateLabel(gap.dueDate)}` : 'No deadline'}</span></div></button>)}</div> : <EmptyState compact title="Transfer proof clear" description="No command files are waiting on transfer papers." />}
          </Panel>

          <Panel title="Care holds" meta={<Pill tone={careDueCount ? 'amber' : 'emerald'}>{careDueCount ? 'Due now' : 'Current'}</Pill>} surfaceId="command-care-board" style={{ order: careDueCount ? 0 : 2 }} action={<div className="inline-actions"><Link to="/weather" className="button button--ghost button--compact">Field Conditions</Link><Link to="/medical" className="button button--ghost button--compact">Care Status</Link></div>}>
            {careBoard.length ? <div className="stack-list">{careBoard.slice(0, 6).map((row) => <button key={row.horseId} type="button" className="stack-item stack-item--interactive" onClick={() => navigate(`/horses/${row.horseId}`)} onContextMenu={(event) => { event.preventDefault(); setMenuState({ type: 'horse', id: row.horseId, x: event.clientX, y: event.clientY }); }}><div className="stack-item__top"><div className="stack-item__title">{row.horseName}</div><Pill tone={row.priority >= 4 ? 'rose' : 'amber'}>{row.priority >= 4 ? 'Hot' : 'Watch'}</Pill></div><div className="dashboard-chip-row">{row.signals.map((signal) => <Pill key={signal.key} tone={CARE_SIGNAL_TONE[signal.status]}>{signal.label} {signal.status === 'clear' ? 'ok' : signal.status}</Pill>)}</div><div className="inline-metrics">{row.signals.filter((signal) => signal.status !== 'clear').slice(0, 2).map((signal) => <span key={signal.key}>{signal.description}</span>)}</div></button>)}</div> : <EmptyState compact title="No care board yet" description="Care status appears once command files and proof records exist." />}
          </Panel>
        </div>

        <aside className="dashboard-board__side">
          <Panel title="Proof queue" action={<Link to="/documents" className="button button--ghost button--compact">Proof Vault</Link>}>
            {reviewQueue.length ? <div className="stack-list">{reviewQueue.slice(0, 5).map((document) => <button key={document.id} type="button" className="stack-item stack-item--interactive" onClick={() => navigate('/documents')}><div className="stack-item__top"><div className="stack-item__title">{document.title}</div><Pill tone="amber">{document.state}</Pill></div><div className="stack-item__copy">{document.type} · {document.uploadedAt ? formatDateLabel(document.uploadedAt) : 'No date'}</div></button>)}</div> : <EmptyState compact title="Proof queue clear" description="No documents are waiting on review." />}
          </Panel>

          <Panel title="Buyer desk" action={<Link to="/sales" className="button button--ghost button--compact">Buyer Desk</Link>}>
            {salesLeads.length ? <div className="stack-list">{salesLeads.slice(0, 4).map((lead) => { const horse = horses.find((item) => item.id === lead.horseId); return <button key={lead.id} type="button" className="stack-item stack-item--interactive" onClick={() => navigate('/sales')} onContextMenu={(event) => { event.preventDefault(); setMenuState({ type: 'lead', id: lead.id, x: event.clientX, y: event.clientY }); }}><div className="stack-item__top"><div className="stack-item__title">{lead.buyerName}</div><Pill tone={lead.stage === 'Offer' ? 'blue' : 'slate'}>{lead.stage}</Pill></div><div className="stack-item__copy">{horse?.name ?? 'No horse assigned'} · {lead.nextFollowUpDate ? `Follow up ${formatDateLabel(lead.nextFollowUpDate)}` : 'No follow-up date'}</div></button>; })}</div> : <EmptyState compact title="No buyer movement" description="Buyer activity appears here once leads are attached to command files." />}
          </Panel>

          <Panel title="Operating ledger" action={<Link to="/expenses" className="button button--ghost button--compact">Ledger</Link>}>
            <form className="quick-expense-form" onSubmit={handleReceiptSubmit}>
              <select className="field-input" value={receiptDraft.horseId} onChange={(event) => setReceiptDraft((current) => ({ ...current, horseId: event.target.value }))}><option value="">General ranch cost</option>{horses.map((horse) => <option key={horse.id} value={horse.id}>{horse.name}</option>)}</select>
              <input className="field-input" placeholder="Receipt title" value={receiptDraft.title} onChange={(event) => setReceiptDraft((current) => ({ ...current, title: event.target.value }))} required />
              <div className="form-grid form-grid--two"><select className="field-input" value={receiptDraft.category} onChange={(event) => setReceiptDraft((current) => ({ ...current, category: event.target.value as ExpenseCategory }))}>{EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select><input className="field-input" type="number" min="0" step="0.01" placeholder="Amount" value={receiptDraft.amount} onChange={(event) => setReceiptDraft((current) => ({ ...current, amount: event.target.value }))} required /></div>
              <div className="form-grid form-grid--two"><input className="field-input" placeholder="Vendor" value={receiptDraft.vendor} onChange={(event) => setReceiptDraft((current) => ({ ...current, vendor: event.target.value }))} /><input className="field-input" type="date" value={receiptDraft.receiptDate} onChange={(event) => setReceiptDraft((current) => ({ ...current, receiptDate: event.target.value }))} /></div>
              <textarea className="field-input field-input--textarea" placeholder="Notes" value={receiptDraft.notes} onChange={(event) => setReceiptDraft((current) => ({ ...current, notes: event.target.value }))} />
              <input className="field-input" type="file" accept="image/*,.pdf" onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)} />
              <button className="button button--primary button--compact" type="submit" disabled={savingReceipt || !canManageBudget}>{savingReceipt ? 'Logging...' : 'Log receipt'}</button>
            </form>
            <div className="inline-metrics inline-metrics--summary"><span>Total {formatCurrency(budgetSummary.total)}</span><span>Feed {formatCurrency(budgetSummary.feed)}</span><span>Health {formatCurrency(budgetSummary.health)}</span></div>
          </Panel>
        </aside>
      </div>

      {menuState && menuItems.length ? <ContextMenu x={menuState.x} y={menuState.y} items={menuItems} onClose={() => setMenuState(null)} /> : null}
    </>
  );
}

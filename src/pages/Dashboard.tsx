import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { buildBudgetSummary, buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { formatCompactCurrency, formatCurrency, formatDateLabel } from '@/lib/format';
import { resolveWeatherByQuery, type WeatherForecast } from '@/lib/weather';
import { useCurrentRoleCapability, useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';
import { useUiStore } from '@/store/useUiStore';
import type { ExpenseCategory } from '@/types/xbar';

const expenseCategories: ExpenseCategory[] = ['Feed', 'Wormer', 'Dental Float', 'Farrier', 'Vet Care', 'Supplements', 'Bedding', 'Travel'];

const careSignalTone: Record<'due' | 'watch' | 'clear', 'rose' | 'amber' | 'emerald'> = {
  due: 'rose',
  watch: 'amber',
  clear: 'emerald',
};

function fieldDate(value?: string) {
  return value ? formatDateLabel(value) : 'No date set';
}

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
  const sharedListings = useXbarStore((state) => state.sharedListings);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const addExpenseReceipt = useXbarStore((state) => state.addExpenseReceipt);
  const roleWorkspace = useCurrentRoleWorkspace();
  const canManageBudget = useCurrentRoleCapability('manageAssets');
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
  const activeListings = sharedListings.filter((listing) => listing.state === 'Live');
  const careDueCount = careBoard.filter((row) => row.signals.some((signal) => signal.status === 'due')).length;
  const cogginsWatchCount = careBoard.filter((row) => row.signals.some((signal) => signal.key === 'coggins' && signal.status !== 'clear')).length;
  const qualifiedBuyerCount = salesLeads.filter((lead) => lead.stage === 'Qualified' || lead.stage === 'Offer').length;
  const buyerFollowUps = salesLeads
    .filter((lead) => lead.stage !== 'Closed')
    .sort((left, right) => Date.parse(left.nextFollowUp || '9999-12-31') - Date.parse(right.nextFollowUp || '9999-12-31'));
  const feedReserveAsset = ranchAssets.find((asset) => asset.category === 'Feed & Supply');
  const recentBatches = intakeBatches.slice(0, 4);
  const hasWorkspaceData = Boolean(
    horses.length ||
      documents.length ||
      ownershipRecords.length ||
      expenseReceipts.length ||
      salesLeads.length ||
      intakeBatches.length ||
      ranchAssets.length ||
      sharedListings.length,
  );

  const priorityWork = useMemo(
    () => [
      ...transferGaps.slice(0, 3).map((gap) => ({
        id: `transfer-${gap.horseId}`,
        title: gap.horseName,
        meta: `${gap.pendingCount} title items`,
        detail: gap.reasons.slice(0, 2).join(' / '),
        tone: 'rose' as const,
        href: `/horses/${gap.horseId}`,
      })),
      ...careBoard.slice(0, 3).map((row) => {
        const nextSignal = row.signals.find((signal) => signal.status !== 'clear');
        return {
          id: `care-${row.horseId}`,
          title: row.horseName,
          meta: nextSignal?.label ?? 'Care review',
          detail: nextSignal?.detail ?? 'Care record needs review',
          tone: row.priority >= 4 ? ('rose' as const) : ('amber' as const),
          href: `/horses/${row.horseId}`,
        };
      }),
      ...reviewQueue.slice(0, 2).map((document) => ({
        id: `document-${document.id}`,
        title: document.title,
        meta: document.type,
        detail: document.summary || document.extractedTextPreview || 'Document needs review.',
        tone: 'blue' as const,
        href: '/documents',
      })),
    ].slice(0, 6),
    [careBoard, reviewQueue, transferGaps],
  );

  useEffect(() => {
    const ranchQuery = workspaceProfile.ranchName.trim();
    if (!ranchQuery) {
      setWeather(null);
      setWeatherError('Set the ranch name to load a local forecast.');
      return;
    }

    let cancelled = false;
    setWeatherLoading(true);
    setWeatherError(null);

    void resolveWeatherByQuery(ranchQuery)
      .then((forecast) => {
        if (!cancelled) {
          setWeather(forecast);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setWeather(null);
          setWeatherError(error instanceof Error ? error.message : 'Weather could not load.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWeatherLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceProfile.ranchName]);

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

  if (!hasWorkspaceData) {
    return (
      <>
        <PageHeader
          title="Today"
          actions={
            <>
              <Link to="/horses?new=1" className="button button--primary button--compact">
                New horse
              </Link>
              <Link to="/documents?upload=1" className="button button--ghost button--compact">
                Upload docs
              </Link>
              <Link to="/weather" className="button button--ghost button--compact">
                Weather
              </Link>
            </>
          }
        />

        <section className="command-stage">
          <div className="command-stage__lead">
            <div className="command-stage__eyebrow">Ops Core</div>
            <h2 className="command-stage__title">Modern ranch operations, finally organized.</h2>
            <p className="command-stage__copy">Start clean. Add real horses, real documents, and real care dates. XBAR will stay quiet until there is work that deserves attention.</p>
            <div className="command-stage__chips">
              <Pill tone="blue">No fake records</Pill>
              <Pill tone="slate">Real workspace</Pill>
              <Pill tone="emerald">Ready for first entry</Pill>
            </div>
          </div>
          <div className="command-stage__rail">
            <MetricCard label="Horse records" value="0" tone="slate" title="No horses yet" />
            <MetricCard label="Care dates" value="0" tone="slate" title="No care dates yet" />
            <MetricCard label="Documents" value="0" tone="slate" title="No documents yet" />
          </div>
        </section>

        <div className="dashboard-grid dashboard-grid--primary">
          <Panel eyebrow="Workspace" title="Build from real records">
            <EmptyState
              title="Everything in one place. Finally."
              description="Create the first horse, upload the first packet, or set the ranch forecast. The command center fills itself from real work."
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

          <Panel eyebrow="First moves" title="Start here">
            <div className="stack-list">
              <div className="stack-item">
                <div className="stack-item__title">Horse ledger</div>
                <div className="stack-item__copy">Add one verified horse record. Leave unknown fields blank until they are confirmed.</div>
              </div>
              <div className="stack-item">
                <div className="stack-item__title">Document vault</div>
                <div className="stack-item__copy">Upload registration, Coggins, transfer, and vet documents as source files.</div>
              </div>
              <div className="stack-item">
                <div className="stack-item__title">Care cadence</div>
                <div className="stack-item__copy">Use dated receipts and care records so Coggins, wormer, dental, and farrier work surface on time.</div>
              </div>
            </div>
          </Panel>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Today"
        actions={
          <>
            <Link to="/weather" className="button button--ghost button--compact">
              Weather
            </Link>
            <Link to="/documents" className="button button--ghost button--compact">
              Review docs
            </Link>
            <Link to="/horses?new=1" className="button button--primary button--compact">
              New horse
            </Link>
          </>
        }
      />

      <section className="command-stage">
        <div className="command-stage__lead">
          <div className="command-stage__eyebrow">{workspaceProfile.ranchName || 'Daily operations'}</div>
          <h2 className="command-stage__title">Less chaos. Better operations.</h2>
          <p className="command-stage__copy">Today shows the work that can cost time, trust, or money if it gets buried.</p>
          <div className="command-stage__chips">
            <Pill tone="blue">{roleWorkspace.label}</Pill>
            <Pill tone={transferGaps.length ? 'rose' : 'emerald'}>{transferGaps.length} title gaps</Pill>
            <Pill tone={careDueCount ? 'amber' : 'emerald'}>{careDueCount} care due</Pill>
            <Pill tone={activeListings.length ? 'blue' : 'slate'}>{activeListings.length} live buyer rooms</Pill>
            {weather ? <Pill tone="slate">{weather.current.temperatureF}°F</Pill> : null}
          </div>
          <div className="command-stage__ledger">
            <div className="command-stage__ledger-item">
              <span>Month</span>
              <strong>{formatCompactCurrency(budgetSummary.total)}</strong>
            </div>
            <div className="command-stage__ledger-item">
              <span>Buyers</span>
              <strong>{qualifiedBuyerCount}</strong>
            </div>
            <div className="command-stage__ledger-item">
              <span>Queue</span>
              <strong>{reviewQueue.length}</strong>
            </div>
          </div>
        </div>

        <div className="command-stage__rail">
          <MetricCard label="Title gaps" value={String(transferGaps.length)} tone={transferGaps.length ? 'rose' : 'emerald'} onClick={() => navigate('/ownership')} title="Open title and transfer" />
          <MetricCard label="Care due" value={String(careDueCount)} tone={careDueCount ? 'amber' : 'emerald'} onClick={() => navigate('/medical')} title="Open care records" />
          <MetricCard label="This month" value={formatCompactCurrency(budgetSummary.total)} tone="blue" onClick={() => navigate('/')} title="Operating spend this month" />
        </div>

        <div className="command-stage__support">
          <div className="command-stage__support-card">
            <div className="command-stage__support-label">Weather watch</div>
            <strong className="command-stage__support-title">
              {weatherLoading ? 'Loading weather' : weather ? `${weather.current.temperatureF}°F · ${weather.current.weatherLabel}` : 'Forecast offline'}
            </strong>
            <div className="command-stage__support-copy">
              <span>{weather ? `${weather.today.rainChance}% rain · ${weather.current.windMph} mph wind · UV ${weather.today.uvIndex}` : weatherError || 'Set the ranch location.'}</span>
              <span>{weather ? weather.notes.turnout : 'Use weather to plan turnout, hauling, and breeding work.'}</span>
            </div>
          </div>
          <div className="command-stage__support-card">
            <div className="command-stage__support-label">Feed room</div>
            <strong className="command-stage__support-title">{feedReserveAsset?.name ?? 'Not logged'}</strong>
            <div className="command-stage__support-copy">
              <span>{feedReserveAsset?.notes ?? 'Add feed receipts to start reserve tracking.'}</span>
              <span>{feedReserveAsset?.nextService ? `Service ${formatDateLabel(feedReserveAsset.nextService)}` : 'No service date'}</span>
            </div>
          </div>
          <div className="command-stage__support-card">
            <div className="command-stage__support-label">Intake</div>
            <strong className="command-stage__support-title">{recentBatches[0]?.label ?? 'No batch yet'}</strong>
            <div className="command-stage__support-copy">
              <span>{recentBatches[0] ? `${recentBatches[0].processedCount}/${recentBatches[0].fileCount} logged` : 'Upload the first packet.'}</span>
              <span>{reviewQueue.length} waiting on review</span>
            </div>
          </div>
        </div>
      </section>

      <div className="metric-grid metric-grid--dashboard">
        <MetricCard label="Review queue" value={String(reviewQueue.length)} tone={reviewQueue.length ? 'blue' : 'slate'} onClick={() => navigate('/documents')} title="Documents waiting on review" />
        <MetricCard label="Coggins watch" value={String(cogginsWatchCount)} tone={cogginsWatchCount ? 'amber' : 'emerald'} onClick={() => navigate('/medical')} title="Coggins records missing or aging" />
        <MetricCard label="Buyer movement" value={String(buyerFollowUps.length)} tone={buyerFollowUps.length ? 'blue' : 'slate'} onClick={() => navigate('/sales')} title="Open buyer follow-ups" />
        <MetricCard label="Health spend" value={formatCompactCurrency(budgetSummary.health)} tone="slate" onClick={() => navigate('/')} title="Health-related spend this month" />
      </div>

      <div className="dashboard-board">
        <div className="dashboard-board__main">
          <Panel
            title="Today"
            meta={<Pill tone={priorityWork.length ? 'amber' : 'emerald'}>{priorityWork.length ? 'Needs eyes' : 'Quiet'}</Pill>}
            action={<Link to="/horses" className="button button--ghost button--compact">Horse ledger</Link>}
          >
            {priorityWork.length ? (
              <div className="stack-list">
                {priorityWork.map((item) => (
                  <Link key={item.id} to={item.href} className="stack-item stack-item--interactive">
                    <div className="stack-item__top">
                      <div className="stack-item__title">{item.title}</div>
                      <Pill tone={item.tone}>{item.meta}</Pill>
                    </div>
                    <div className="stack-item__copy">{item.detail}</div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState compact title="Nothing urgent" description="No transfer, care, or document blockers need attention right now." />
            )}
          </Panel>

          <Panel
            title="Care due"
            meta={<Pill tone={careDueCount ? 'amber' : 'emerald'}>{careDueCount ? 'Due now' : 'Current'}</Pill>}
            action={<Link to="/medical" className="button button--ghost button--compact">Care records</Link>}
          >
            {careBoard.length ? (
              <div className="stack-list">
                {careBoard.slice(0, 6).map((row) => (
                  <Link key={row.horseId} to={`/horses/${row.horseId}`} className="stack-item stack-item--interactive">
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
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState compact title="Care board clear" description="Dated Coggins, wormer, and dental evidence is current." />
            )}
          </Panel>

          <Panel
            title="Title & transfer"
            meta={<Pill tone={transferGaps.length ? 'rose' : 'emerald'}>{transferGaps.length ? 'Needs action' : 'Clear'}</Pill>}
            action={<Link to="/ownership" className="button button--ghost button--compact">Open</Link>}
          >
            {transferGaps.length ? (
              <div className="stack-list">
                {transferGaps.slice(0, 6).map((gap) => (
                  <Link key={gap.horseId} to={`/horses/${gap.horseId}`} className="stack-item stack-item--interactive">
                    <div className="stack-item__top">
                      <div className="stack-item__title">{gap.horseName}</div>
                      <Pill tone={gap.transferStatus === 'Clear' ? 'emerald' : 'rose'}>{gap.transferStatus}</Pill>
                    </div>
                    <div className="dashboard-chip-row">
                      {gap.reasons.slice(0, 3).map((reason) => (
                        <Pill key={reason} tone="amber">{reason}</Pill>
                      ))}
                    </div>
                    <div className="inline-metrics">
                      <span>{gap.pendingCount} blockers</span>
                      <span>{gap.dueDate ? `Due ${formatDateLabel(gap.dueDate)}` : 'No deadline'}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState compact title="Transfer packet clear" description="No horses are waiting on transfer papers." />
            )}
          </Panel>
        </div>

        <div className="dashboard-board__side">
          <Panel
            title="Buyer movement"
            meta={<Pill tone={buyerFollowUps.length ? 'blue' : 'slate'}>{buyerFollowUps.length} active</Pill>}
            action={<Link to="/sales" className="button button--ghost button--compact">Sale board</Link>}
          >
            {buyerFollowUps.length ? (
              <div className="stack-list">
                {buyerFollowUps.slice(0, 5).map((lead) => {
                  const horse = horses.find((item) => item.id === lead.horseId);
                  return (
                    <Link key={lead.id} to="/sales" className="stack-item stack-item--interactive">
                      <div className="stack-item__top">
                        <div className="stack-item__title">{lead.name}</div>
                        <Pill tone={lead.stage === 'Offer' ? 'emerald' : lead.stage === 'Qualified' ? 'blue' : 'amber'}>{lead.stage}</Pill>
                      </div>
                      <div className="inline-metrics">
                        <span>{horse?.name ?? 'Unassigned'}</span>
                        <span>{lead.channel}</span>
                        <span>{fieldDate(lead.nextFollowUp || lead.lastTouch)}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState compact title="No buyer follow-ups" description="Qualified buyer movement will show here." />
            )}
          </Panel>

          <Panel
            title="Receipts"
            meta={<Pill tone="blue">{budgetSummary.receiptCount} receipts</Pill>}
            action={
              <button type="button" className="button button--ghost button--compact" onClick={() => document.getElementById('dashboard-receipt-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
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

            {budgetSummary.latestReceipts.length ? (
              <div className="stack-list">
                {budgetSummary.latestReceipts.slice(0, 4).map((receipt) => (
                  <Link key={receipt.id} to={receipt.horseId ? `/horses/${receipt.horseId}` : '/'} className="stack-item stack-item--interactive">
                    <div className="stack-item__top">
                      <div className="stack-item__title">{receipt.title}</div>
                      <Pill tone="blue">{formatCurrency(receipt.amount)}</Pill>
                    </div>
                    <div className="inline-metrics">
                      <span>{receipt.category}</span>
                      <span>{receipt.vendor}</span>
                      <span>{formatDateLabel(receipt.receiptDate)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState compact title="No receipts logged" description="Feed, care, and travel costs will appear here." />
            )}
          </Panel>

          <Panel title="Document review" meta={<Pill tone={reviewQueue.length ? 'amber' : 'emerald'}>{reviewQueue.length ? 'Active' : 'Quiet'}</Pill>}>
            {recentBatches.length || reviewQueue.length ? (
              <div className="stack-list">
                {recentBatches.map((batch) => (
                  <Link key={batch.id} to="/documents" className="stack-item stack-item--interactive">
                    <div className="stack-item__top">
                      <div className="stack-item__title">{batch.label}</div>
                      <Pill tone={batch.state === 'Completed' ? 'emerald' : batch.state === 'Reviewing' ? 'amber' : 'blue'}>{batch.state}</Pill>
                    </div>
                    <div className="inline-metrics">
                      <span>{batch.processedCount}/{batch.fileCount} logged</span>
                      <span>{batch.needsReviewCount} review</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState compact title="No document queue" description="Uploads waiting on review will land here." />
            )}
          </Panel>
        </div>
      </div>

      <div className="dashboard-board dashboard-board--lower">
        <Panel title="Receipt intake" meta={<Pill tone={canManageBudget ? 'blue' : 'slate'}>{canManageBudget ? 'Enabled' : 'Read only'}</Pill>}>
          <form id="dashboard-receipt-form" className="dashboard-receipt-form" onSubmit={handleReceiptSubmit}>
            <div className="form-grid form-grid--tight">
              <label className="field-stack">
                <span className="field-label">Category</span>
                <select className="field-input" value={receiptDraft.category} onChange={(event) => setReceiptDraft((current) => ({ ...current, category: event.target.value as ExpenseCategory }))} disabled={!canManageBudget || savingReceipt}>
                  {expenseCategories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>

              <label className="field-stack">
                <span className="field-label">Horse</span>
                <select className="field-input" value={receiptDraft.horseId} onChange={(event) => setReceiptDraft((current) => ({ ...current, horseId: event.target.value }))} disabled={!canManageBudget || savingReceipt}>
                  <option value="">Ranch-wide</option>
                  {horses.map((horse) => (
                    <option key={horse.id} value={horse.id}>{horse.name}</option>
                  ))}
                </select>
              </label>

              <label className="field-stack">
                <span className="field-label">Receipt label</span>
                <input className="field-input" value={receiptDraft.title} onChange={(event) => setReceiptDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Dental float" disabled={!canManageBudget || savingReceipt} />
              </label>

              <label className="field-stack">
                <span className="field-label">Vendor</span>
                <input className="field-input" value={receiptDraft.vendor} onChange={(event) => setReceiptDraft((current) => ({ ...current, vendor: event.target.value }))} placeholder="Rolling Plains Vet" disabled={!canManageBudget || savingReceipt} />
              </label>

              <label className="field-stack">
                <span className="field-label">Amount</span>
                <input className="field-input" type="number" min="0" step="0.01" value={receiptDraft.amount} onChange={(event) => setReceiptDraft((current) => ({ ...current, amount: event.target.value }))} placeholder="240.00" disabled={!canManageBudget || savingReceipt} />
              </label>

              <label className="field-stack">
                <span className="field-label">Receipt date</span>
                <input className="field-input" type="date" value={receiptDraft.receiptDate} onChange={(event) => setReceiptDraft((current) => ({ ...current, receiptDate: event.target.value }))} disabled={!canManageBudget || savingReceipt} />
              </label>

              <label className="field-stack">
                <span className="field-label">Uploaded by</span>
                <input className="field-input" value={receiptDraft.uploadedBy} onChange={(event) => setReceiptDraft((current) => ({ ...current, uploadedBy: event.target.value }))} disabled={!canManageBudget || savingReceipt} />
              </label>

              <label className="field-stack">
                <span className="field-label">Receipt file</span>
                <input className="field-input" type="file" accept=".pdf,image/*" onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)} disabled={!canManageBudget || savingReceipt} />
              </label>

              <label className="field-stack field-stack--wide">
                <span className="field-label">Notes</span>
                <textarea className="field-textarea" value={receiptDraft.notes} onChange={(event) => setReceiptDraft((current) => ({ ...current, notes: event.target.value }))} rows={3} placeholder="Optional note for feed reserve, wormer pack, or dental work." disabled={!canManageBudget || savingReceipt} />
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
    </>
  );
}

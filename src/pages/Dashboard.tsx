import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { buildBudgetSummary, buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { buildCommandCenter, buildFieldTools } from '@/lib/xbarGrowth';
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
  const sharedAccess = useXbarStore((state) => state.sharedAccess);
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

  const reviewQueue = useMemo(() => documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched'), [documents]);
  const transferGaps = useMemo(() => buildTransferGapRows(horses, ownershipRecords, documents), [horses, ownershipRecords, documents]);
  const careBoard = useMemo(() => buildCareBoardRows(horses, documents, expenseReceipts), [horses, documents, expenseReceipts]);
  const budgetSummary = useMemo(() => buildBudgetSummary(expenseReceipts), [expenseReceipts]);
  const careDueCount = useMemo(() => careBoard.filter((row) => row.signals.some((signal) => signal.status === 'due')).length, [careBoard]);
  const cogginsWatchCount = useMemo(() => careBoard.filter((row) => row.signals.some((signal) => signal.key === 'coggins' && signal.status !== 'clear')).length, [careBoard]);
  const qualifiedBuyerCount = useMemo(() => salesLeads.filter((lead) => lead.stage === 'Qualified' || lead.stage === 'Offer').length, [salesLeads]);
  const feedReserveAsset = useMemo(() => ranchAssets.find((asset) => asset.category === 'Feed & Supply'), [ranchAssets]);
  const recentBatches = useMemo(() => intakeBatches.slice(0, 4), [intakeBatches]);
  const commandCenter = useMemo(
    () => buildCommandCenter({ horses, documents, ownershipRecords, salesLeads, ranchAssets, intakeBatches }),
    [horses, documents, ownershipRecords, salesLeads, ranchAssets, intakeBatches],
  );
  const fieldTools = useMemo(
    () => buildFieldTools({ horses, documents, ownershipRecords, salesLeads, sharedAccess }),
    [horses, documents, ownershipRecords, salesLeads, sharedAccess],
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
          label: 'Open sale profile',
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
        <div className="ops-briefing-header">
          <div className="ops-briefing-header__top">
            <div className="ops-briefing-header__left">
              <div className="ops-briefing-header__ranch">{workspaceProfile.ranchName || workspaceProfile.businessName || 'Ranch Operations'}</div>
              <h1 className="ops-briefing-header__title">Build the dashboard</h1>
              <div className="ops-briefing-header__chips">
                <span className="ops-briefing-chip">First horse</span>
                <span className="ops-briefing-chip">Document vault</span>
                <span className="ops-briefing-chip">Budget ledger</span>
                <span className="ops-briefing-chip">Weather watch</span>
              </div>
            </div>
            <div className="ops-briefing-header__actions">
              <Link to="/horses?new=1" className="ops-briefing-action ops-briefing-action--primary">New horse</Link>
              <Link to="/documents?upload=1" className="ops-briefing-action">Bulk upload</Link>
              <Link to="/settings" className="ops-briefing-action">Settings</Link>
            </div>
          </div>
          <div className="ops-briefing-stat-row">
            <div className="ops-briefing-stat">
              <span className="ops-briefing-stat__label">Horses</span>
              <span className="ops-briefing-stat__value ops-briefing-stat__value--clear">0</span>
              <span className="ops-briefing-stat__detail">No records yet</span>
            </div>
            <div className="ops-briefing-stat">
              <span className="ops-briefing-stat__label">Documents</span>
              <span className="ops-briefing-stat__value">0</span>
              <span className="ops-briefing-stat__detail">Vault is empty</span>
            </div>
            <div className="ops-briefing-stat">
              <span className="ops-briefing-stat__label">Transfers</span>
              <span className="ops-briefing-stat__value ops-briefing-stat__value--clear">0</span>
              <span className="ops-briefing-stat__detail">None pending</span>
            </div>
            <div className="ops-briefing-stat">
              <span className="ops-briefing-stat__label">Buyers</span>
              <span className="ops-briefing-stat__value">0</span>
              <span className="ops-briefing-stat__detail">No active leads</span>
            </div>
          </div>
        </div>

        <div className="dashboard-grid dashboard-grid--primary">
          <Panel eyebrow="Ranch" title="Start the ranch desk">
            <EmptyState
              title="No records yet"
              description="Create the first horse, upload a packet, or load the ranch forecast to start working."
              action={
                <div className="inline-actions">
                  <Link to="/horses?new=1" className="button button--primary button--compact">
                    Create horse
                  </Link>
                  <Link to="/documents?upload=1" className="button button--ghost button--compact">
                    Bulk upload
                  </Link>
                  <Link to="/settings" className="button button--ghost button--compact">
                    Settings
                  </Link>
                  <Link to="/weather" className="button button--ghost button--compact">
                    Weather
                  </Link>
                </div>
              }
            />
          </Panel>

          <Panel eyebrow="First steps" title="What to build first">
            <div className="stack-list">
              <div className="stack-item">
                <div className="stack-item__title">Horse record</div>
                <div className="stack-item__copy">One horse gives the system something to organize around. Add the name, breed, barn, and owner.</div>
              </div>
              <div className="stack-item">
                <div className="stack-item__title">Document vault</div>
                <div className="stack-item__copy">Upload the first packet. Coggins, registration, and health papers establish the chain of record.</div>
              </div>
              <div className="stack-item">
                <div className="stack-item__title">Spend ledger</div>
                <div className="stack-item__copy">Log feed, wormer, dental, and vet costs. The budget builds itself once receipts come in.</div>
              </div>
              <div className="stack-item">
                <div className="stack-item__title">Weather watch</div>
                <div className="stack-item__copy">Set the ranch location and get turnout, hauling, and breeding windows tied to the forecast.</div>
              </div>
            </div>
          </Panel>
        </div>
      </>
    );
  }

  async function handleReceiptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receiptDraft.title.trim() || !receiptDraft.amount || Number(receiptDraft.amount) <= 0) {
      pushToast({ title: 'Required fields missing', message: 'Receipt label and amount are required.', tone: 'error' });
      return;
    }
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

  const urgencyCount = transferGaps.length + careDueCount;

  return (
    <>
      <div className="ops-briefing-header">
        <div className="ops-briefing-header__top">
          <div className="ops-briefing-header__left">
            <div className="ops-briefing-header__ranch">{workspaceProfile.ranchName || workspaceProfile.businessName || 'Ranch Operations'}</div>
            <h1 className="ops-briefing-header__title">
              {urgencyCount > 0
                ? `${urgencyCount} item${urgencyCount > 1 ? 's' : ''} need${urgencyCount === 1 ? 's' : ''} attention.`
                : 'Ranch desk is clear.'}
            </h1>
            <div className="ops-briefing-header__chips">
              <span className="ops-briefing-chip">{roleWorkspace.label}</span>
              <span className={transferGaps.length ? 'ops-briefing-chip ops-briefing-chip--urgent' : 'ops-briefing-chip ops-briefing-chip--success'}>
                {transferGaps.length} transfer{transferGaps.length !== 1 ? 's' : ''} pending
              </span>
              <span className={careDueCount ? 'ops-briefing-chip ops-briefing-chip--warning' : 'ops-briefing-chip ops-briefing-chip--success'}>
                {careDueCount} care due
              </span>
              {weather ? (
                <span className="ops-briefing-chip">{weather.current.temperatureF}°F · {weather.current.weatherLabel}</span>
              ) : null}
            </div>
          </div>
          <div className="ops-briefing-header__actions">
            <Link to="/horses?new=1" className="ops-briefing-action ops-briefing-action--primary">New horse</Link>
            <Link to="/documents" className="ops-briefing-action">Review docs</Link>
            <Link to="/weather" className="ops-briefing-action">Weather</Link>
          </div>
        </div>
        <div className="ops-briefing-stat-row">
          <Link to="/ownership" className="ops-briefing-stat ops-briefing-stat--clickable" title="Open ownership records">
            <span className="ops-briefing-stat__label">Transfers</span>
            <span className={`ops-briefing-stat__value${transferGaps.length ? ' ops-briefing-stat__value--urgent' : ' ops-briefing-stat__value--clear'}`}>
              {transferGaps.length}
            </span>
            <span className="ops-briefing-stat__detail">{transferGaps.length ? 'need resolution' : 'all clear'}</span>
          </Link>
          <Link to="/medical" className="ops-briefing-stat ops-briefing-stat--clickable" title="Open care board">
            <span className="ops-briefing-stat__label">Care due</span>
            <span className={`ops-briefing-stat__value${careDueCount ? ' ops-briefing-stat__value--warning' : ' ops-briefing-stat__value--clear'}`}>
              {careDueCount}
            </span>
            <span className="ops-briefing-stat__detail">{careDueCount ? 'horses overdue' : 'care current'}</span>
          </Link>
          <Link to="/documents" className="ops-briefing-stat ops-briefing-stat--clickable" title="Documents waiting on review">
            <span className="ops-briefing-stat__label">Doc queue</span>
            <span className={`ops-briefing-stat__value${reviewQueue.length ? ' ops-briefing-stat__value--warning' : ''}`}>
              {reviewQueue.length}
            </span>
            <span className="ops-briefing-stat__detail">{reviewQueue.length ? 'waiting review' : 'queue clear'}</span>
          </Link>
          <Link to="/expenses" className="ops-briefing-stat ops-briefing-stat--clickable" title="Open expense ledger">
            <span className="ops-briefing-stat__label">Month spend</span>
            <span className="ops-briefing-stat__value">{formatCompactCurrency(budgetSummary.total)}</span>
            <span className="ops-briefing-stat__detail">{qualifiedBuyerCount} active lead{qualifiedBuyerCount !== 1 ? 's' : ''}</span>
          </Link>
        </div>
      </div>

      <section className="command-stage command-stage--two-col">
        <div className="command-stage__rail">
          <MetricCard
            label="Transfer issues"
            value={String(transferGaps.length)}
            tone={transferGaps.length ? 'rose' : 'emerald'}
            href="/ownership"
            title="Open ownership records"
          />
          <MetricCard
            label="Care due"
            value={String(careDueCount)}
            tone={careDueCount ? 'amber' : 'emerald'}
            href="/medical"
            title="Open care board"
          />
          <MetricCard
            label="This month"
            value={formatCompactCurrency(budgetSummary.total)}
            tone="blue"
            href="/expenses"
            title="Open expense ledger"
          />
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
            <div className="command-stage__support-label">Upload</div>
            <strong className="command-stage__support-title">
              {recentBatches[0]?.label ?? 'No batch yet'}
            </strong>
            <div className="command-stage__support-copy">
              <span>{recentBatches[0] ? `${recentBatches[0].processedCount}/${recentBatches[0].fileCount} logged` : 'Upload the first packet.'}</span>
              <span>{reviewQueue.length} waiting on review</span>
            </div>
          </div>
          <div className="command-stage__support-card">
            <div className="command-stage__support-label">Weather watch</div>
            <strong className="command-stage__support-title">
              {weatherLoading ? 'Loading...' : weather ? `${weather.current.temperatureF}°F · ${weather.current.weatherLabel}` : 'Forecast offline'}
            </strong>
            <div className="command-stage__support-copy">
              <span>
                {weather
                  ? `${weather.today.rainChance}% rain · ${weather.current.windMph} mph wind · UV ${weather.today.uvIndex}`
                  : weatherError || 'Open Weather and set the ranch location.'}
              </span>
              <span>{weather ? weather.notes.turnout : 'Use weather to plan turnout, hauling, and breeding work.'}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="metric-grid metric-grid--dashboard">
        <MetricCard
          label="Review queue"
          value={String(reviewQueue.length)}
          tone={reviewQueue.length ? 'blue' : 'slate'}
          href="/documents"
          title="Documents waiting on review"
        />
        <MetricCard
          label="Coggins watch"
          value={String(cogginsWatchCount)}
          tone={cogginsWatchCount ? 'amber' : 'emerald'}
          href="/medical"
          title="Horses missing or aging coggins"
        />
        <MetricCard
          label="Feed spend"
          value={formatCompactCurrency(budgetSummary.feed)}
          tone="blue"
          href="/expenses"
          title="Feed, bedding, and supplement spend this month"
        />
        <MetricCard
          label="Health spend"
          value={formatCompactCurrency(budgetSummary.health)}
          tone="slate"
          href="/expenses"
          title="Health-related spend this month"
        />
      </div>

      <div>
        <div className="ops-section-label">Command center</div>
        <div className="ops-cmd">
          {commandCenter.map((item) => (
            <Link key={item.id} to={item.href} className={`ops-cmd-item ops-cmd-item--${item.tone}`}>
              <div className="ops-cmd-item__module">{item.module}</div>
              <div className="ops-cmd-item__title">{item.title}</div>
              <div className="ops-cmd-item__bottom">
                <span className="ops-cmd-item__summary">{item.summary}</span>
                <span className={`pill pill--${item.tone}`}>{item.value}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="dashboard-board">
        <div className="dashboard-board__main">
          <Panel
            title="Transfer issues"
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
                  <Link
                    key={gap.horseId}
                    to={`/horses/${gap.horseId}`}
                    className="stack-item stack-item--interactive"
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
                  </Link>
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
              <div className="inline-actions">
                <Link to="/weather" className="button button--ghost button--compact">
                  Weather
                </Link>
                <Link to="/medical" className="button button--ghost button--compact">
                  Medical
                </Link>
              </div>
            }
          >
            {careBoard.length ? (
              <div className="stack-list">
                {careBoard.slice(0, 6).map((row) => (
                  <Link
                    key={row.horseId}
                    to={`/horses/${row.horseId}`}
                    className="stack-item stack-item--interactive"
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
                        <Pill key={signal.key} tone={CARE_SIGNAL_TONE[signal.status]}>
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
              <EmptyState compact title="Care board clear" description="Wormer, dental, and coggins are current." />
            )}
          </Panel>
        </div>

        <div className="dashboard-board__side">
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
            title="Recent receipts"
            meta={<Pill tone="slate">{budgetSummary.latestReceipts.length} latest</Pill>}
          >
            {budgetSummary.latestReceipts.length ? (
              <div className="stack-list">
                {budgetSummary.latestReceipts.map((receipt) => (
                  <Link
                    key={receipt.id}
                    to={receipt.horseId ? `/horses/${receipt.horseId}` : '/expenses'}
                    className="stack-item stack-item--interactive"
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
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState compact title="No receipts logged" description="Budget entries will appear here after upload." />
            )}
          </Panel>
        </div>
      </div>

      <div>
        <div className="ops-section-label">Field tools</div>
        <div className="field-tools">
          {fieldTools.map((tool) => (
            <Link key={tool.id} to={tool.href} className={`field-tool-card field-tool-card--${tool.tone}`}>
              <div className="field-tool-card__eyebrow">{tool.eyebrow}</div>
              <div className="field-tool-card__title">{tool.title}</div>
              <div className="field-tool-card__summary">{tool.summary}</div>
              <div className="field-tool-card__metric">{tool.metric}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="dashboard-board dashboard-board--lower">
        <Panel
          title="Log receipt"
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
                  {EXPENSE_CATEGORIES.map((category) => (
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
                <span className="field-label">Receipt label <span aria-hidden="true" className="field-required">*</span></span>
                <input
                  className="field-input"
                  required
                  aria-required="true"
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
                <span className="field-label">Amount <span aria-hidden="true" className="field-required">*</span></span>
                <input
                  className="field-input"
                  type="number"
                  required
                  aria-required="true"
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

        <Panel
          title="Queue"
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
                <Link
                  key={lead.id}
                  to="/sales"
                  className="stack-item stack-item--interactive"
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
                </Link>
              );
            })}
          </div>
        </Panel>
      </div>

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}

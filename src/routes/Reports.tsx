import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, FileText, Lock, Palette } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { useDayKey } from '@/hooks/useDayKey';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { ReadinessChart } from '@/components/saas';
import { HorsesIcon } from '@/components/icons';
import { useEffectiveSubscription } from '@/hooks/useOwnerPreview';
import { requestFeatureUpgrade } from '@/store/useUpgradeStore';
import { formatCompactCurrency, formatCurrency } from '@/lib/format';
import { buildRanchReport } from '@/lib/ranchReport';
import { downloadRanchReportCsv, downloadRanchReportPdf } from '@/lib/ranchReportExport';
import { profitIntelligenceGate } from '@/lib/subscriptionGates';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './operationsExperience.css';
import './reportsExperience.css';
import { canPresentPurchaseFlow } from '@/lib/nativePlatform';
import {
  DEFAULT_REPORT_PRESENTATION,
  REPORT_ACCENT_PRESETS,
  resolveReportPresentation,
  validReportAccent,
  type ReportPresentation,
} from '@/lib/reportPresentation';
import { useCloudStore } from '@/store/useCloudStore';

/*
 * What the operation is worth, what it costs, and what is holding money up.
 *
 * This screen used to show three counts and a readiness donut — nothing about
 * money, and no way to get any of it out of the app. The arithmetic was already
 * in the product (businessIntelligence.ts) but only ever appeared per-horse in
 * the sale-packet wizard and as alerts on the reminders screen, so there was no
 * place that answered the question an owner actually asks.
 *
 * The money half is profit intelligence, which is a Ranch Ops feature —
 * `commercialEngine.ts` says so, and Financials and Expenses have gated it all
 * along. Surfacing cost, break-even, margin and spend anomalies here without
 * the same gate made this screen a way around the paywall, and the exports made
 * it a way around it in a file you could keep. So the gate wraps the analytics
 * AND both export buttons.
 *
 * Readiness and the document count stay open. They were on this screen before
 * this change and are not profit intelligence, so gating them would take
 * something away from Starter rather than protect something paid.
 */
export default function Reports() {
  const navigate = useNavigate();
  const pushToast = useUiStore((state) => state.pushToast);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  // Effective, not real: an allowlisted owner previewing Ranch Ops sees what a
  // Ranch Ops customer sees. This screen gates a feature, so it reads the
  // preview — unlike the billing screen, which reports on billing itself.
  const subscription = useEffectiveSubscription();
  const locked = profitIntelligenceGate(subscription);
  const [exporting, setExporting] = useState<'pdf' | null>(null);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const presentationScope = workspaceId || workspaceProfile.ranchName;
  const [presentationState, setPresentationState] = useState({
    scope: presentationScope,
    options: DEFAULT_REPORT_PRESENTATION,
  });
  const requestedPresentation =
    presentationState.scope === presentationScope ? presentationState.options : DEFAULT_REPORT_PRESENTATION;
  const presentation = resolveReportPresentation(subscription.tier, requestedPresentation);
  const updatePresentation = (patch: Partial<ReportPresentation>) =>
    setPresentationState({ scope: presentationScope, options: { ...requestedPresentation, ...patch } });
  const customAccentValid = validReportAccent(requestedPresentation.accent);

  const presentationStudio = (
    <section className="report-studio" aria-labelledby="report-studio-title">
      <div className="report-studio__heading">
        <div>
          <span className="report-studio__eyebrow">Your records, beautifully prepared</span>
          <h2 id="report-studio-title">Report presentation</h2>
          <p>
            Make a report that belongs to your ranch. Every version keeps the same figures, source notes and complete
            registers.
          </p>
        </div>
        <Palette size={24} aria-hidden="true" />
      </div>
      <div className="report-studio__grid">
        <div className="report-studio__preview" style={{ borderTopColor: presentation.accent }}>
          <span className="report-studio__preview-label">Style preview · illustrative</span>
          <FileText size={28} aria-hidden="true" />
          <strong>{workspaceProfile.ranchName || 'Your ranch'}</strong>
          <span>
            {presentation.layout === 'cover'
              ? 'Executive cover + complete report'
              : 'Executive dashboard + complete registers'}
          </span>
          <div className="report-studio__preview-bars" aria-hidden="true">
            <i style={{ backgroundColor: presentation.accent }} />
            <i style={{ backgroundColor: presentation.accent }} />
            <i style={{ backgroundColor: presentation.accent }} />
          </div>
          <small>
            {presentation.whiteLabel
              ? 'Ranch-first artwork · XBAR source attribution retained'
              : 'Ranch identity · XBAR artwork and source attribution'}
          </small>
        </div>
        <div className="report-studio__controls">
          <div className="report-studio__tier">
            <span>Ranch Ops</span>
            <strong>Executive styling</strong>
          </div>
          {locked ? (
            <>
              <p>Choose your report color and add a polished executive cover.</p>
              {canPresentPurchaseFlow() && (
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => requestFeatureUpgrade('reportPresentation')}
                >
                  Customize your reports
                  <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              )}
            </>
          ) : (
            <>
              <fieldset className="report-studio__accents">
                <legend>Report accent</legend>
                {Object.entries(REPORT_ACCENT_PRESETS).map(([label, color]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={presentation.accent === color}
                    onClick={() => updatePresentation({ accent: color })}
                  >
                    <i style={{ backgroundColor: color }} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </fieldset>
              <label className="report-studio__color">
                Your ranch color
                <input
                  type="color"
                  value={requestedPresentation.accent}
                  onChange={(event) => updatePresentation({ accent: event.target.value })}
                />
              </label>
              {!customAccentValid && (
                <p className="report-studio__note" role="status">
                  Choose a darker color for readable text. The preview and PDF keep the standard accent until it passes
                  contrast checks.
                </p>
              )}
              <label className="report-studio__check">
                <input
                  type="checkbox"
                  checked={presentation.layout === 'cover'}
                  onChange={(event) => updatePresentation({ layout: event.target.checked ? 'cover' : 'standard' })}
                />
                Add an executive cover
              </label>
            </>
          )}
          <div className="report-studio__tier">
            <span>Enterprise</span>
            <strong>Ranch-first presentation</strong>
          </div>
          {subscription.tier === 'Enterprise' ? (
            <label className="report-studio__check">
              <input
                type="checkbox"
                checked={presentation.whiteLabel}
                onChange={(event) => updatePresentation({ whiteLabel: event.target.checked })}
              />
              Hide decorative XBAR artwork
            </label>
          ) : (
            <>
              {canPresentPurchaseFlow() && (
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => requestFeatureUpgrade('reportWhiteLabel')}
                >
                  Explore ranch-first styling
                  <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              )}
            </>
          )}
          <small className="report-studio__note">
            Source attribution and verification identity always stay visible. CSV files keep the original data format.
          </small>
        </div>
      </div>
    </section>
  );

  const reportInput = useMemo(
    () => ({ horses, documents, expenseReceipts, salesLeads, ownershipRecords }),
    [horses, documents, expenseReceipts, salesLeads, ownershipRecords],
  );

  /*
   * Half of this report is a function of the clock, not of the data: the
   * generated date, what counts as "this month", the trailing three-month
   * window, the spend anomalies measured against it, and every Coggins-expiry
   * verdict in the risk assessment.
   *
   * Memoized on the data alone, a tab left open on this screen overnight kept
   * yesterday's answers until something in the workspace changed. `dayKey`
   * changes at midnight and nowhere else, so the report refreshes exactly when
   * its time-dependent parts actually move.
   */
  const dayKey = useDayKey();

  const report = useMemo(
    () => buildRanchReport(reportInput),
    // dayKey is a dependency because it is what makes the clock observable
    // here; buildRanchReport reads the current time itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reportInput, dayKey],
  );

  const readinessSegments = [
    { label: '95%+ complete, no recorded blockers', value: report.readiness.ready, tone: 'var(--xbar-success)' },
    { label: 'Getting there', value: report.readiness.gettingThere, tone: 'var(--xbar-warning)' },
    { label: 'Not ready', value: report.readiness.notReady, tone: 'var(--xbar-danger)' },
  ];

  const handlePdf = async () => {
    // Checked here as well as on the button. The button is disabled when
    // locked, but a disabled button is a rendering detail — the export is the
    // paid capability, and it must refuse on its own rather than trusting that
    // nothing reached it.
    if (locked) return;
    setExporting('pdf');
    try {
      // Built fresh, not from the memo. This file is handed to a banker with a
      // date printed on it; the screen refreshes at midnight, but an export
      // fired in the seconds before that must not carry yesterday's date and
      // last month's totals into a document that outlives the tab.
      const saved = await downloadRanchReportPdf(buildRanchReport(reportInput), workspaceProfile.ranchName, {
        tier: subscription.tier,
        options: presentation,
        profile: workspaceProfile,
      });
      // A save that did not happen must not be reported as one. On iOS the
      // anchor-download trick silently does nothing, and a cancelled share
      // sheet leaves the file nowhere the customer chose.
      if (!saved.ok) {
        pushToast({ title: 'Report was not saved', message: saved.reason, tone: 'warning' });
      }
    } catch {
      // Rendering happens in this tab with data already in memory, so the only
      // way here is a genuine failure. Say so rather than leaving a button that
      // looks like it worked.
      pushToast({
        title: 'Report could not be created',
        message: 'Nothing was saved. Try again, or export the spreadsheet instead.',
        tone: 'warning',
      });
    } finally {
      setExporting(null);
    }
  };

  const handleCsv = async () => {
    if (locked) return;
    const saved = await downloadRanchReportCsv(buildRanchReport(reportInput), workspaceProfile.ranchName);
    if (!saved.ok) {
      pushToast({ title: 'Spreadsheet was not saved', message: saved.reason, tone: 'warning' });
    }
  };

  // Only truly empty when there is nothing to report on at all.
  //
  // Keying this on horses alone hid every logged receipt from a workspace that
  // had recorded general ranch spend before adding its first horse — and took
  // both exports away with it — even though the report totals receipts that are
  // not tied to a horse and renders fine with an empty roster.
  //
  // Documents count for the same reason, and matter more than they look:
  // DocumentRecord.horseId is optional, so an operation can upload documents
  // before its first horse exists. The document count is one of the two things
  // this screen keeps open to every tier, so hiding it here contradicted the
  // gating decision three lines up.
  if (horses.length === 0 && expenseReceipts.length === 0 && salesLeads.length === 0 && documents.length === 0) {
    return (
      <div className="ops-experience reports-experience">
        <section className="ops-hero ops-hero--solo" aria-labelledby="reports-title">
          <div>
            <div className="ops-kicker">Ranch reporting</div>
            <h1 id="reports-title">Know what the herd is worth</h1>
            <p>
              Cost per horse, break-even, what is waiting on documents, and where the spend is going — in one report you
              can hand to a banker or an accountant.
            </p>
          </div>
        </section>
        {presentationStudio}
        <Panel title="Nothing to report yet" description="Add horses and log receipts to see the numbers here.">
          <EmptyState
            title="No horses on record"
            description="The report is built from your horses, receipts, documents and offers. Add a horse to get started."
            action={
              <button className="button button--primary" type="button" onClick={() => navigate('/horses')}>
                Add a horse
              </button>
            }
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="ops-experience reports-experience">
      <section className="ops-hero" aria-labelledby="reports-title">
        <div>
          <div className="ops-kicker">Ranch reporting</div>
          <h1 id="reports-title">Know what the herd is worth</h1>
          <p>
            Cost per horse, break-even, what is waiting on documents, and where the spend is going. Export it and hand
            it to a banker, an accountant or a partner.
          </p>
          <div className="ops-hero__actions">
            {locked ? (
              // Guideline 3.1.1 forbids the call to action, not just the
              // charge. The locked explanation above stays; only the button
              // that invites a purchase goes.
              canPresentPurchaseFlow() ? (
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => requestFeatureUpgrade('profitIntelligence')}
                >
                  Unlock with Ranch Ops
                </button>
              ) : null
            ) : (
              <>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={handlePdf}
                  disabled={exporting === 'pdf'}
                >
                  {exporting === 'pdf' ? 'Creating PDF…' : 'Download PDF report'}
                </button>
                <button className="button button--ghost" type="button" onClick={handleCsv}>
                  Export spreadsheet
                </button>
              </>
            )}
          </div>
        </div>
        {locked ? (
          <div className="ops-hero__ledger" aria-label="Ranch reporting is a Ranch Ops feature">
            <span>Ranch Ops</span>
            <strong className="report-locked__headline">
              <Lock size={22} aria-hidden="true" /> Locked
            </strong>
            <small>Cost per horse, break-even, margin and spend trends — with PDF and spreadsheet export.</small>
          </div>
        ) : (
          <div className="ops-hero__ledger" aria-label="Money summary">
            <span>Invested to date</span>
            <strong>{formatCompactCurrency(report.money.investedToDate)}</strong>
            {/* Invested-to-date now includes what the horses cost to buy, so the
                split is shown here — otherwise the headline cannot be
                reconciled against the receipts a rancher has on file. */}
            <small>
              {formatCompactCurrency(report.money.acquisitionCost)} in purchases ·{' '}
              {formatCompactCurrency(report.money.receiptSpend)} in spend ·{' '}
              {report.money.monthlyBurn === null ? 'Unknown' : formatCurrency(report.money.monthlyBurn)}
              /mo recorded average (history unconfirmed)
            </small>
            <div className="ops-hero__mini-grid">
              <div>
                <span>Listed</span>
                <b>{formatCompactCurrency(report.money.listedValue)}</b>
              </div>
              <div>
                <span>Held up</span>
                <b>{formatCompactCurrency(report.money.valueAtRisk)}</b>
              </div>
            </div>
          </div>
        )}
      </section>
      {presentationStudio}

      {locked ? (
        <Panel
          className="ops-panel"
          title="Unlock ranch reporting"
          description="Cost per horse, break-even and margin, what is holding each sale up, and where the spend is going — with PDF and spreadsheet export."
        >
          <EmptyState
            title={locked}
            description="Ranch Ops turns the records you already keep into the numbers a banker, an accountant or a partner asks for."
            // Same locked state as the hero button above, so it gets the same
            // answer. Leaving this one lit while gating that one would put two
            // different answers to one question on a single screen.
            action={
              canPresentPurchaseFlow() ? (
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => requestFeatureUpgrade('profitIntelligence')}
                >
                  See Ranch Ops
                </button>
              ) : null
            }
          />
        </Panel>
      ) : (
        <>
          <div className="ops-metric-grid">
            <MetricCard
              className="ops-metric-card"
              label="Ready to close"
              value={formatCompactCurrency(report.money.readyValue)}
              detail="Listed value with no blockers"
              tone="emerald"
            />
            <MetricCard
              className="ops-metric-card"
              /*
               * Not "Waiting on documents". `assessRevenueAtRisk` adds a horse's
               * asking price for ANY blocker, and two of them are not documents
               * at all: an active medical review, and a transfer that is merely
               * unmarked. Naming the total after one of its causes sent the
               * reader looking for a missing file that does not exist — and the
               * same figure goes in front of a banker in the PDF.
               */
              label="Held up"
              value={formatCompactCurrency(report.money.valueAtRisk)}
              detail={`${report.risk.items.length} horse${report.risk.items.length === 1 ? '' : 's'} blocked`}
              tone={report.money.valueAtRisk > 0 ? 'amber' : 'slate'}
            />
            <MetricCard
              className="ops-metric-card"
              label="Open offers"
              value={formatCompactCurrency(report.money.pipelineValue)}
              detail={`${formatCurrency(report.money.depositsHeld)} in deposits held · ${formatCurrency(report.money.unappliedReceipts)} in other unapplied receipts`}
              tone="blue"
            />
            <MetricCard
              className="ops-metric-card"
              label="Sale payments received"
              value={formatCompactCurrency(report.money.collectedFromSales)}
              detail={`${formatCurrency(report.money.closedSaleValue)} agreed · ${formatCurrency(report.money.outstandingFromSales)} still owed. Paid deposits on closed sales are included.`}
              tone="blue"
            />
            <MetricCard
              className="ops-metric-card"
              label="Recorded cash total"
              value={formatCompactCurrency(report.money.totalCashReceived)}
              detail={`${formatCurrency(report.money.depositsHeld)} held deposits · ${formatCurrency(report.money.unappliedReceipts)} other unapplied receipts. Not profit or a bank balance.`}
              tone="blue"
            />
            <MetricCard
              className="ops-metric-card"
              label="Spent this month"
              value={formatCompactCurrency(report.money.investedThisMonth)}
              // Not "of that": buildRanchReport deliberately excludes purchase
              // prices from investedThisMonth, because a purchase carries no date.
              // Presenting a lifetime acquisition total as part of this month's
              // spend contradicted the model directly — "$100 spent this month,
              // $10,000 of that is purchase prices".
              detail={`${formatCompactCurrency(report.money.receiptSpend)} of recorded spend all-time`}
              tone="slate"
            />
          </div>

          {report.risk.items.length > 0 ? (
            <Panel
              className="ops-panel"
              title="What is holding up a sale"
              description="Listed dollars a buyer cannot close on today, largest first."
            >
              <div className="report-risk">
                {report.risk.items.map((item) => (
                  <div className="report-risk__row" key={item.horseId}>
                    <div className="report-risk__main">
                      <span className="report-risk__name">{item.horseName}</span>
                      <span className="report-risk__blockers">{item.blockers.join(' · ')}</span>
                    </div>
                    <span className="report-risk__amount">{formatCurrency(item.askPrice)}</span>
                    <button
                      className="button button--ghost button--compact"
                      type="button"
                      onClick={() => navigate(item.actionRoute)}
                    >
                      {item.actionLabel}
                    </button>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel
            className="ops-panel"
            title="Cost and margin by horse"
            description="Recorded costs and monthly averages, with the same recorded-cost sale floor as Sales. Missing history or costs remain unknown."
          >
            <div className="report-table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Horse</th>
                    <th scope="col" className="report-table__num">
                      Invested
                    </th>
                    <th scope="col" className="report-table__num">
                      Recorded monthly avg
                    </th>
                    <th scope="col" className="report-table__num">
                      Asking
                    </th>
                    <th scope="col" className="report-table__num">
                      Break-even
                    </th>
                    <th scope="col" className="report-table__num">
                      Margin
                    </th>
                    <th scope="col" className="report-table__num">
                      Floor
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.horses.map((horse) => (
                    <tr
                      key={horse.horseId}
                      onClick={() => navigate(`/horses/${horse.horseId}`)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          navigate(`/horses/${horse.horseId}`);
                        }
                      }}
                      tabIndex={0}
                      role="link"
                      aria-label={`${horse.horseName}, open profile`}
                    >
                      <th scope="row">
                        <span className="report-table__name">{horse.horseName}</span>
                        <span className="report-table__meta">{horse.status}</span>
                      </th>
                      <td className="report-table__num">{formatCurrency(horse.investedToDate)}</td>
                      <td className="report-table__num">
                        {horse.monthlyBurn === null ? 'Unknown' : formatCurrency(horse.monthlyBurn)}
                      </td>
                      {/* Showing $0 would read as "worth nothing" rather than
                      "no price yet", and the three derived columns are
                      meaningless without an asking price. But "not listed" is a
                      different statement from "no price", and this report counts
                      Sale Prep, Market Ready and Buyer Review as inventory — so
                      saying "not listed for sale" under a summary that just
                      counted the horse as listed contradicted itself. */}
                      {horse.askPrice > 0 ? (
                        <>
                          <td className="report-table__num">{formatCurrency(horse.askPrice)}</td>
                          <td className="report-table__num">
                            {horse.breakEvenPrice === null ? 'Unknown' : formatCurrency(horse.breakEvenPrice)}
                          </td>
                          <td className="report-table__num">
                            <Pill
                              tone={
                                horse.projectedMargin === null
                                  ? 'slate'
                                  : horse.projectedMargin >= 0
                                    ? 'emerald'
                                    : 'rose'
                              }
                            >
                              {horse.projectedMargin === null ? 'Unknown' : formatCurrency(horse.projectedMargin)} ·{' '}
                              {horse.marginPercent === null ? 'Cost records missing' : `${horse.marginPercent}%`}
                            </Pill>
                          </td>
                          <td className="report-table__num">
                            {horse.safeDiscountFloor === null ? 'Unknown' : formatCurrency(horse.safeDiscountFloor)}
                          </td>
                        </>
                      ) : (
                        <td className="report-table__num report-table__muted" colSpan={4}>
                          {horse.financialStatus === 'sold'
                            ? `Sold: ${horse.closedSaleValue === null ? 'sale price unknown' : formatCurrency(horse.closedSaleValue)} · gross result ${horse.closedSaleProfit === null ? 'unknown' : formatCurrency(horse.closedSaleProfit)} before overhead, not cash received`
                            : horse.saleInventory
                              ? 'Asking price not set'
                              : 'Not listed for sale'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      <div className={`ops-workspace${locked ? '' : ' ops-workspace--columns'}`}>
        {locked ? null : (
          <Panel
            className="ops-panel"
            title="Where the spend goes"
            description={`${formatCurrency(report.money.receiptSpend)} of recorded spend across ${report.categories.length} categor${report.categories.length === 1 ? 'y' : 'ies'}.`}
          >
            {report.categories.length ? (
              <div className="report-bars">
                {report.categories.map((category) => (
                  <div className="report-bar" key={category.category}>
                    <div className="report-bar__head">
                      <span>{category.category}</span>
                      <span>
                        {formatCurrency(category.total)} · {category.share}%
                      </span>
                    </div>
                    <div className="report-bar__track">
                      <div className="report-bar__fill" style={{ width: `${Math.max(category.share, 2)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="No receipts logged"
                description="Upload receipts to see where the money goes and what each horse costs."
                action={
                  <button className="button button--ghost" type="button" onClick={() => navigate('/expenses')}>
                    Log a receipt
                  </button>
                }
              />
            )}
          </Panel>
        )}

        <Panel
          className="ops-panel"
          title="Record readiness"
          description={`${report.readiness.average}% average across ${report.horses.filter((horse) => horse.financialStatus !== 'sold').length} unsold horse${report.horses.filter((horse) => horse.financialStatus !== 'sold').length === 1 ? '' : 's'}.`}
        >
          <div className="report-readiness">
            <ReadinessChart
              score={report.readiness.average}
              segments={readinessSegments}
              mark={<HorsesIcon width={26} height={26} />}
            />
            <div className="xs-legend">
              {readinessSegments.map((segment) => (
                <span key={segment.label} className="xs-legend__item">
                  <span className="xs-legend__swatch" style={{ background: segment.tone }} /> {segment.label} ·{' '}
                  {segment.value}
                </span>
              ))}
            </div>
          </div>
          {report.documentsToReview > 0 ? (
            <button className="button button--ghost button--block" type="button" onClick={() => navigate('/documents')}>
              {report.documentsToReview} document{report.documentsToReview === 1 ? '' : 's'} to review
            </button>
          ) : null}
        </Panel>
      </div>

      {!locked && report.anomalies.length > 0 ? (
        <Panel
          className="ops-panel"
          title="Running above trend"
          description="Categories more than 25% above their three-month average."
        >
          <div className="report-risk">
            {report.anomalies.map((anomaly) => (
              <div className="report-risk__row" key={anomaly.category}>
                <div className="report-risk__main">
                  <span className="report-risk__name">{anomaly.category}</span>
                  <span className="report-risk__blockers">
                    {formatCurrency(anomaly.monthTotal)} this month vs {formatCurrency(anomaly.trailingAverage)} average
                  </span>
                </div>
                <span className="report-risk__amount">+{anomaly.deltaPercent}%</span>
                <button
                  className="button button--ghost button--compact"
                  type="button"
                  onClick={() => navigate(anomaly.actionRoute)}
                >
                  {anomaly.actionLabel}
                </button>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

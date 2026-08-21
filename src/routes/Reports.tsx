import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { ReadinessChart } from '@/components/saas';
import { HorsesIcon } from '@/components/icons';
import { useEffectiveSubscription } from '@/hooks/useOwnerPreview';
import { billingPath } from '@/lib/billingRoutes';
import { formatCompactCurrency, formatCurrency } from '@/lib/format';
import { buildRanchReport } from '@/lib/ranchReport';
import { downloadRanchReportCsv, downloadRanchReportPdf } from '@/lib/ranchReportExport';
import { profitIntelligenceGate } from '@/lib/subscriptionGates';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './operationsExperience.css';
import './reportsExperience.css';

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

  const report = useMemo(
    () => buildRanchReport({ horses, documents, expenseReceipts, salesLeads, ownershipRecords }),
    [horses, documents, expenseReceipts, salesLeads, ownershipRecords],
  );

  const readinessSegments = [
    { label: 'Ready to sell', value: report.readiness.ready, tone: 'var(--xbar-success)' },
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
      await downloadRanchReportPdf(report, workspaceProfile.ranchName);
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

  const handleCsv = () => {
    if (locked) return;
    downloadRanchReportCsv(report);
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
      <div className="ops-experience">
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
    <div className="ops-experience">
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
              <button className="button button--primary" type="button" onClick={() => navigate(billingPath)}>
                Unlock with Ranch Ops
              </button>
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
              {formatCompactCurrency(report.money.receiptSpend)} in spend · {formatCurrency(report.money.monthlyBurn)}
              /mo
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

      {locked ? (
        <Panel
          className="ops-panel"
          title="Unlock ranch reporting"
          description="Cost per horse, break-even and margin, what is holding each sale up, and where the spend is going — with PDF and spreadsheet export."
        >
          <EmptyState
            title={locked}
            description="Ranch Ops turns the records you already keep into the numbers a banker, an accountant or a partner asks for."
            action={
              <button className="button button--primary" type="button" onClick={() => navigate(billingPath)}>
                See Ranch Ops
              </button>
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
              label="Waiting on documents"
              value={formatCompactCurrency(report.money.valueAtRisk)}
              detail={`${report.risk.items.length} horse${report.risk.items.length === 1 ? '' : 's'} blocked`}
              tone={report.money.valueAtRisk > 0 ? 'amber' : 'slate'}
            />
            <MetricCard
              className="ops-metric-card"
              label="Open offers"
              value={formatCompactCurrency(report.money.pipelineValue)}
              detail={`${formatCurrency(report.money.depositsHeld)} in deposits held`}
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
            description="What each horse has cost, what it burns per month, and the lowest price worth taking."
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
                      Per month
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
                      <td className="report-table__num">{formatCurrency(horse.monthlyBurn)}</td>
                      {/* A horse with no asking price is not listed. Showing $0
                      would read as "worth nothing" rather than "not for sale",
                      and the three derived columns are meaningless without it. */}
                      {horse.askPrice > 0 ? (
                        <>
                          <td className="report-table__num">{formatCurrency(horse.askPrice)}</td>
                          <td className="report-table__num">{formatCurrency(horse.breakEvenPrice)}</td>
                          <td className="report-table__num">
                            <Pill tone={horse.projectedMargin >= 0 ? 'emerald' : 'rose'}>
                              {formatCurrency(horse.projectedMargin)} · {horse.marginPercent}%
                            </Pill>
                          </td>
                          <td className="report-table__num">{formatCurrency(horse.safeDiscountFloor)}</td>
                        </>
                      ) : (
                        <td className="report-table__num report-table__muted" colSpan={4}>
                          Not listed for sale
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
          title="Sale readiness"
          description={`${report.readiness.average}% average across ${report.horseCount} horse${report.horseCount === 1 ? '' : 's'}.`}
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

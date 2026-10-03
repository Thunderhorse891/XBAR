import { brandAssetPath } from '@/lib/brandAssets';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { kindCopy } from '@/features/reminders/helpers';
import type { ReminderFilter, ReminderKind } from '@/features/reminders/types';
import { buildAlertDigest, buildAlertMailto } from '@/lib/alertCenter';
import { assessRevenueAtRisk, detectSpendAnomalies } from '@/lib/businessIntelligence';
import { buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { buildExpiryRadar, expiryReminderItems } from '@/lib/documentExpiry';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { buildOperationsPriorities } from '@/lib/operationsPriority';
import { useXbarStore } from '@/store/useXbarStore';
import './remindersExperience.css';

export default function Reminders() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const [filter, setFilter] = useState<ReminderFilter>('All');
  const [query, setQuery] = useState('');

  const briefing = useMemo(() => {
    const careRows = buildCareBoardRows(horses, documents, expenseReceipts);
    return buildOperationsPriorities({
      careRows,
      transferRows: buildTransferGapRows(horses, ownershipRecords, documents),
      documents,
      salesLeads,
      horseNames: Object.fromEntries(horses.map((horse) => [horse.id, horse.name])),
      expiringDocuments: expiryReminderItems(buildExpiryRadar(documents, horses), careRows),
    });
  }, [documents, expenseReceipts, horses, ownershipRecords, salesLeads]);

  const digest = useMemo(() => buildAlertDigest(briefing.items), [briefing.items]);
  const revenueRisk = useMemo(
    () => assessRevenueAtRisk(horses, ownershipRecords, documents),
    [horses, ownershipRecords, documents],
  );
  const spendAnomalies = useMemo(() => detectSpendAnomalies(expenseReceipts), [expenseReceipts]);
  const reminders = briefing.items;
  const filteredReminders = reminders.filter((reminder) => {
    const normalized = query.trim().toLowerCase();
    const haystack = [
      reminder.title,
      reminder.kind,
      reminder.urgency,
      reminder.timing,
      reminder.horseName,
      reminder.detail,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return (filter === 'All' || reminder.kind === filter) && (!normalized || haystack.includes(normalized));
  });

  const careCount = reminders.filter((reminder) => reminder.kind === 'Care').length;
  const ownershipCount = reminders.filter((reminder) => reminder.kind === 'Ownership').length;
  const filters: ReminderFilter[] = ['All', 'Care', 'Ownership', 'Documents', 'Sales'];

  return (
    <div className="reminders-page">
      <header className="reminders-header" aria-labelledby="reminders-title">
        <div className="reminders-header__copy">
          <p className="reminders-kicker">Daily operations</p>
          <h1 id="reminders-title">Reminders</h1>
          <p>Care, documents, transfers, and buyer follow-ups in one work queue.</p>
          <div className="reminders-actions">
            <button
              className="reminders-button reminders-button--light"
              type="button"
              onClick={() => briefing.top[0] && navigate(briefing.top[0].route)}
              disabled={!briefing.top.length}
            >
              Start first priority
            </button>
            <a
              className="reminders-button reminders-button--on-dark"
              href={buildAlertMailto(digest, workspaceProfile.operationsEmail)}
            >
              Email alert digest
            </a>
            <button
              className="reminders-button reminders-button--on-dark"
              type="button"
              onClick={() => navigate('/medical')}
            >
              Open health
            </button>
          </div>
        </div>
        <img
          className="reminders-header__art"
          src={brandAssetPath('xbar-report-horse.png')}
          width="1672"
          height="941"
          alt=""
          aria-hidden="true"
        />
      </header>

      <dl className="reminders-metrics" aria-label="Daily operations summary">
        <div>
          <dt>Due</dt>
          <dd>{briefing.dueCount}</dd>
          <dd className="reminders-metric-detail">Needs attention first</dd>
        </div>
        <div>
          <dt>Overdue</dt>
          <dd>{briefing.overdueCount}</dd>
          <dd className="reminders-metric-detail">Past the planned date</dd>
        </div>
        <div>
          <dt>This week</dt>
          <dd>{briefing.thisWeekCount}</dd>
          <dd className="reminders-metric-detail">Today through seven days</dd>
        </div>
        <div>
          <dt>On watch</dt>
          <dd>{briefing.watchCount}</dd>
          <dd className="reminders-metric-detail">Upcoming work to review</dd>
        </div>
      </dl>

      <section className="reminders-panel" aria-labelledby="reminders-queue-title">
        <div className="reminders-section-heading">
          <div>
            <h2 id="reminders-queue-title">Work queue</h2>
            <p>
              {careCount} care items · {ownershipCount} transfer items
            </p>
          </div>
          <span className="reminders-count" role="status" aria-live="polite">
            {filteredReminders.length} shown
          </span>
        </div>
        <div className="reminders-toolbar">
          <label>
            <span>Search reminders</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Horse, document, transfer, or buyer"
              type="search"
            />
          </label>
          <label>
            <span>Reminder type</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as ReminderFilter)}
              aria-label="Filter reminder type"
            >
              {filters.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        {filteredReminders.length ? (
          <div className="reminders-list">
            {filteredReminders.map((reminder) => (
              <article key={reminder.id} className="reminders-item">
                <div className="reminders-item__copy">
                  <div className="reminders-item__heading">
                    <h3>{reminder.title}</h3>
                    <span
                      className={`reminders-status reminders-status--${reminder.urgency.toLowerCase()}`}
                      data-timing={reminder.timing}
                      aria-label={`${reminder.urgency === 'Due' ? 'Urgent' : reminder.urgency === 'Watch' ? 'High' : 'Low'} priority: ${reminder.timing}`}
                    >
                      {reminder.timing}
                    </span>
                  </div>
                  <p>{reminder.detail}</p>
                  <ul className="reminders-meta" aria-label="Reminder details">
                    <li>{reminder.kind}</li>
                    <li>{reminder.horseName ?? 'Ranch-wide'}</li>
                    {reminder.dueDate && <li>Due {formatDateLabel(reminder.dueDate)}</li>}
                  </ul>
                </div>
                <div className="reminders-item__actions">
                  <button
                    className="reminders-button reminders-button--primary"
                    type="button"
                    onClick={() => navigate(reminder.route)}
                  >
                    {reminder.kind === 'Care'
                      ? 'Add care event'
                      : reminder.kind === 'Ownership'
                        ? 'Review transfer'
                        : reminder.kind === 'Documents'
                          ? 'Review document'
                          : 'Open lead'}
                  </button>
                  {reminder.horseId && (
                    <button
                      className="reminders-button"
                      type="button"
                      onClick={() => navigate(`/horses/${reminder.horseId}`)}
                    >
                      View horse
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : reminders.length ? (
          <div className="reminders-empty">
            <h3>No reminders match</h3>
            <p>Adjust the search or filter.</p>
          </div>
        ) : (
          <div className="reminders-empty">
            <h3>No urgent work in the queue</h3>
            <p>
              Care, transfer, document, and buyer follow-up reminders appear here automatically as your records change.
            </p>
          </div>
        )}
      </section>

      <section className="reminders-panel" aria-labelledby="alert-title">
        <div className="reminders-section-heading">
          <div>
            <h2 id="alert-title">Expiration and action alerts</h2>
            <p>
              {digest.alerts.length
                ? `${digest.overdueCount} overdue and ${digest.dueSoonCount} due today or this week${digest.dueThisMonthCount ? `, plus ${digest.dueThisMonthCount} within 30 days` : ''}.`
                : 'No expiration alerts are open right now.'}
            </p>
          </div>
        </div>
        {digest.alerts.length ? (
          <div className="reminders-card-grid">
            {digest.alerts.slice(0, 3).map((alert) => (
              <button key={alert.id} className="reminders-card" type="button" onClick={() => navigate(alert.route)}>
                <span className="reminders-card__label">
                  {alert.severity === 'critical' ? 'Critical alert' : 'Watch alert'}
                </span>
                <strong>{alert.title}</strong>
                <p>{alert.detail}</p>
                <span className="reminders-card__meta">
                  <span>{alert.kind}</span>
                  <span>{alert.timing}</span>
                  <span>{alert.horseName ?? 'Ranch-wide'}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="reminders-note">
            Coggins, wormer, dental, transfer, document, and follow-up alerts appear automatically as dates age.
          </p>
        )}
      </section>

      <details className="reminders-disclosure">
        <summary>
          Today's ranch briefing <span>{briefing.top.length} priorities</span>
        </summary>
        <div className="reminders-disclosure__body">
          <p className="reminders-note">
            {briefing.top.length
              ? 'These actions carry the most immediate operational risk or value.'
              : 'No urgent work is waiting. The ranch is clear for today.'}
          </p>
          {briefing.top.length ? (
            <div className="reminders-card-grid">
              {briefing.top.map((item, index) => (
                <button key={item.id} className="reminders-card" type="button" onClick={() => navigate(item.route)}>
                  <span className="reminders-card__label">Priority {index + 1}</span>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  <span className="reminders-card__meta">
                    <span>{item.kind}</span>
                    <span>{item.timing}</span>
                    <span>{item.horseName ?? 'Ranch-wide'}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="reminders-note">
              New care, document, ownership, and sales priorities will appear here automatically.
            </p>
          )}
        </div>
      </details>

      <details className="reminders-disclosure">
        <summary>
          Sale readiness and spending{' '}
          <span>
            {revenueRisk.items.length} blocked sales · {spendAnomalies.length} spend alerts
          </span>
        </summary>
        <div className="reminders-disclosure__body">
          <h2 id="revenue-title">Sale value blocked by documents</h2>
          <p className="reminders-note">
            {revenueRisk.items.length
              ? `${formatCompactCurrency(revenueRisk.valueAtRisk)} of ${formatCompactCurrency(revenueRisk.totalListedValue)} listed value cannot close today. Review the blockers below.`
              : revenueRisk.totalListedValue > 0
                ? `All ${formatCompactCurrency(revenueRisk.totalListedValue)} of listed value is document-ready for buyers.`
                : 'List a horse with an asking price and XBAR will track what stands between it and a closed sale.'}
          </p>
          {revenueRisk.items.length ? (
            <div className="reminders-card-grid">
              {revenueRisk.items.slice(0, 3).map((item) => (
                <button
                  key={item.horseId}
                  className="reminders-card"
                  type="button"
                  onClick={() => navigate(item.actionRoute)}
                >
                  <span className="reminders-card__label">
                    {item.askPrice > 0 ? `${formatCompactCurrency(item.askPrice)} blocked` : 'Sale prep blocked'}
                  </span>
                  <strong>{item.actionLabel}</strong>
                  <p>{item.blockers.join(' · ')}</p>
                  <span className="reminders-card__meta">
                    <span>Revenue</span>
                    <span>{item.horseName}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {spendAnomalies.length ? (
            <div className="reminders-card-grid">
              {spendAnomalies.slice(0, 2).map((anomaly) => (
                <button
                  key={anomaly.category}
                  className="reminders-card"
                  type="button"
                  onClick={() => navigate(anomaly.actionRoute)}
                >
                  <span className="reminders-card__label">Spend running {anomaly.deltaPercent}% above trend</span>
                  <strong>{anomaly.actionLabel}</strong>
                  <p>
                    {anomaly.category}: {formatCompactCurrency(anomaly.monthTotal)} this month vs{' '}
                    {formatCompactCurrency(anomaly.trailingAverage)} trailing average.
                  </p>
                  <span className="reminders-card__meta">
                    <span>Spend control</span>
                    <span>Ranch-wide</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </details>

      <details className="reminders-disclosure">
        <summary>About reminder types</summary>
        <div className="reminders-disclosure__body reminders-type-grid">
          {(['Care', 'Ownership', 'Documents', 'Sales'] as ReminderKind[]).map((kind) => {
            const count = reminders.filter((reminder) => reminder.kind === kind).length;
            return (
              <section key={kind}>
                <h3>
                  {kind} <span className="reminders-count">{count}</span>
                </h3>
                <p className="reminders-note">{kindCopy(kind)}</p>
                <button className="reminders-button" type="button" onClick={() => setFilter(kind)}>
                  Show {kind.toLowerCase()}
                </button>
              </section>
            );
          })}
        </div>
      </details>
    </div>
  );
}

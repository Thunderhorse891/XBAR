import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { TaskItem } from '@/components/InteractionSystem';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { kindCopy } from '@/features/reminders/helpers';
import type { ReminderFilter, ReminderKind } from '@/features/reminders/types';
import { buildAlertDigest, buildAlertMailto } from '@/lib/alertCenter';
import { assessRevenueAtRisk, detectSpendAnomalies } from '@/lib/businessIntelligence';
import { buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { buildOperationsPriorities } from '@/lib/operationsPriority';
import { useXbarStore } from '@/store/useXbarStore';
import './operationsExperience.css';
import './priorityExperience.css';

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

  const briefing = useMemo(() => buildOperationsPriorities({
    careRows: buildCareBoardRows(horses, documents, expenseReceipts),
    transferRows: buildTransferGapRows(horses, ownershipRecords, documents),
    documents,
    salesLeads,
    horseNames: Object.fromEntries(horses.map((horse) => [horse.id, horse.name])),
  }), [documents, expenseReceipts, horses, ownershipRecords, salesLeads]);

  const digest = useMemo(() => buildAlertDigest(briefing.items), [briefing.items]);
  const revenueRisk = useMemo(
    () => assessRevenueAtRisk(horses, ownershipRecords, documents),
    [horses, ownershipRecords, documents],
  );
  const spendAnomalies = useMemo(() => detectSpendAnomalies(expenseReceipts), [expenseReceipts]);
  const reminders = briefing.items;
  const filteredReminders = reminders.filter((reminder) => {
    const normalized = query.trim().toLowerCase();
    const haystack = [reminder.title, reminder.kind, reminder.urgency, reminder.timing, reminder.horseName, reminder.detail].filter(Boolean).join(' ').toLowerCase();
    return (filter === 'All' || reminder.kind === filter) && (!normalized || haystack.includes(normalized));
  });

  const careCount = reminders.filter((reminder) => reminder.kind === 'Care').length;
  const ownershipCount = reminders.filter((reminder) => reminder.kind === 'Ownership').length;
  const filters: ReminderFilter[] = ['All', 'Care', 'Ownership', 'Documents', 'Sales'];

  return (
    <div className="ops-experience">
      <section className="ops-hero ops-hero--reminders" aria-labelledby="reminders-title">
        <div>
          <div className="ops-kicker">Daily operations</div>
          <h1 id="reminders-title">Run today before today runs you</h1>
          <p>Automated expiration and action alerts for Coggins, wormer, dental, transfer files, documents, and buyer follow-up. This queue is the reason a barn stops relying on paper calendars.</p>
          <div className="ops-hero__actions">
            <button className="button button--primary" type="button" onClick={() => briefing.top[0] && navigate(briefing.top[0].route)} disabled={!briefing.top.length}>Start first priority</button>
            <a className="button button--ghost" href={buildAlertMailto(digest, workspaceProfile.operationsEmail)}>Email alert digest</a>
            <button className="button button--ghost" type="button" onClick={() => navigate('/medical')}>Open health</button>
          </div>
        </div>
        <div className="ops-hero__ledger" aria-label="Daily operations summary">
          <span>Due now</span>
          <strong>{briefing.dueCount}</strong>
          <small>{briefing.overdueCount} overdue | {briefing.thisWeekCount} due this week</small>
          <div className="ops-hero__mini-grid">
            <div><span>Care</span><b>{careCount}</b></div>
            <div><span>Transfer</span><b>{ownershipCount}</b></div>
          </div>
        </div>
      </section>

      <section className="priority-briefing" aria-labelledby="alert-title">
        <div className="priority-briefing__heading">
          <div>
            <span className="ops-kicker">Automated alert center</span>
            <h2 id="alert-title">Expiration and action alerts</h2>
          </div>
          <p>{digest.alerts.length ? `${digest.overdueCount} overdue and ${digest.dueSoonCount} due today or this week.` : 'No expiration alerts are open right now.'}</p>
        </div>
        {digest.alerts.length ? (
          <div className="priority-grid">
            {digest.alerts.slice(0, 3).map((alert) => (
              <button key={alert.id} className="priority-card" type="button" onClick={() => navigate(alert.route)}>
                <span className="priority-card__index">{alert.severity === 'critical' ? 'Critical alert' : 'Watch alert'}</span>
                <strong>{alert.title}</strong>
                <p>{alert.detail}</p>
                <span className="priority-card__meta"><span>{alert.kind}</span><span>{alert.timing}</span><span>{alert.horseName ?? 'Ranch-wide'}</span></span>
              </button>
            ))}
          </div>
        ) : <EmptyState compact title="Alerts are clear" description="Coggins, wormer, dental, transfer, document, and follow-up alerts will appear automatically as dates age." />}
      </section>

      <section className="priority-briefing" aria-labelledby="revenue-title">
        <div className="priority-briefing__heading">
          <div>
            <span className="ops-kicker">Sale Readiness</span>
            <h2 id="revenue-title">Sale value blocked by documents</h2>
          </div>
          <p>
            {revenueRisk.items.length
              ? `${formatCompactCurrency(revenueRisk.valueAtRisk)} of ${formatCompactCurrency(revenueRisk.totalListedValue)} listed value cannot close today. Each blocker below has a one-click fix.`
              : revenueRisk.totalListedValue > 0
                ? `All ${formatCompactCurrency(revenueRisk.totalListedValue)} of listed value is document-ready for buyers.`
                : 'List a horse with an asking price and XBAR will track what stands between it and a closed sale.'}
          </p>
        </div>
        {revenueRisk.items.length ? (
          <div className="priority-grid">
            {revenueRisk.items.slice(0, 3).map((item) => (
              <button key={item.horseId} className="priority-card" type="button" onClick={() => navigate(item.actionRoute)}>
                <span className="priority-card__index">{item.askPrice > 0 ? `${formatCompactCurrency(item.askPrice)} blocked` : 'Sale prep blocked'}</span>
                <strong>{item.actionLabel}</strong>
                <p>{item.blockers.join(' · ')}</p>
                <span className="priority-card__meta"><span>Revenue</span><span>{item.horseName}</span></span>
              </button>
            ))}
          </div>
        ) : null}
        {spendAnomalies.length ? (
          <div className="priority-grid" style={{ marginTop: 12 }}>
            {spendAnomalies.slice(0, 2).map((anomaly) => (
              <button key={anomaly.category} className="priority-card" type="button" onClick={() => navigate(anomaly.actionRoute)}>
                <span className="priority-card__index">Spend running {anomaly.deltaPercent}% above trend</span>
                <strong>{anomaly.actionLabel}</strong>
                <p>{anomaly.category}: {formatCompactCurrency(anomaly.monthTotal)} this month vs {formatCompactCurrency(anomaly.trailingAverage)} trailing average.</p>
                <span className="priority-card__meta"><span>Spend control</span><span>Ranch-wide</span></span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="priority-briefing" aria-labelledby="briefing-title">
        <div className="priority-briefing__heading">
          <div>
            <span className="ops-kicker">First three moves</span>
            <h2 id="briefing-title">Today's ranch briefing</h2>
          </div>
          <p>{briefing.top.length ? 'These actions carry the most immediate operational risk or value.' : 'No urgent work is waiting. The ranch is clear for today.'}</p>
        </div>
        {briefing.top.length ? (
          <div className="priority-grid">
            {briefing.top.map((item, index) => (
              <button key={item.id} className="priority-card" type="button" onClick={() => navigate(item.route)}>
                <span className="priority-card__index">Priority {index + 1}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <span className="priority-card__meta"><span>{item.kind}</span><span>{item.timing}</span><span>{item.horseName ?? 'Ranch-wide'}</span></span>
              </button>
            ))}
          </div>
        ) : <EmptyState compact title="Today's work is clear" description="New care, document, ownership, and sales priorities will appear here automatically." />}
      </section>

      <div className="ops-metric-grid">
        <MetricCard label="Due" value={String(briefing.dueCount)} detail="Needs attention first" tone={briefing.dueCount ? 'rose' : 'emerald'} className="ops-metric-card" />
        <MetricCard label="Overdue" value={String(briefing.overdueCount)} detail="Past the planned date" tone={briefing.overdueCount ? 'rose' : 'emerald'} className="ops-metric-card" />
        <MetricCard label="This week" value={String(briefing.thisWeekCount)} detail="Today through seven days" tone={briefing.thisWeekCount ? 'amber' : 'emerald'} className="ops-metric-card" />
        <MetricCard label="On watch" value={String(briefing.watchCount)} detail="Not urgent, not ignored" tone={briefing.watchCount ? 'amber' : 'emerald'} className="ops-metric-card" />
      </div>

      <section className="ops-panel">
        <div className="ops-section-heading">
          <div><span className="section-eyebrow">Full work queue</span><h2>Every open operational item</h2></div>
          <Pill tone="blue">{filteredReminders.length} shown</Pill>
        </div>
        <div className="ops-toolbar ops-toolbar--wide">
          <label className="ops-search"><span className="sr-only">Search reminders</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search horse, document, transfer, sale lead..." /></label>
          <select value={filter} onChange={(event) => setFilter(event.target.value as ReminderFilter)} aria-label="Filter reminder type">{filters.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        </div>
        {filteredReminders.length ? (
          <div className="xbar-task-list">
            {filteredReminders.map((reminder) => (
              <TaskItem
                key={reminder.id}
                title={reminder.title}
                detail={`${reminder.detail} | ${reminder.kind} | ${reminder.horseName ?? 'Ranch-wide'}${reminder.dueDate ? ` | ${formatDateLabel(reminder.dueDate)}` : ''}`}
                status={reminder.timing}
                priority={reminder.urgency === 'Due' ? 'urgent' : reminder.urgency === 'Watch' ? 'high' : 'low'}
                onActivate={() => navigate(reminder.route)}
                action={
                  <div className="inline-actions">
                    <button className="button button--primary button--compact" type="button" onClick={() => navigate(reminder.route)}>{reminder.kind === 'Care' ? 'Add care event' : reminder.kind === 'Ownership' ? 'Review transfer' : reminder.kind === 'Documents' ? 'Review document' : 'Open lead'}</button>
                    {reminder.horseId && <button className="button button--ghost button--compact" type="button" onClick={() => navigate(`/horses/${reminder.horseId}`)}>View horse</button>}
                  </div>
                }
              />
            ))}
          </div>
        ) : reminders.length ? <EmptyState compact title="No reminders match" description="Adjust the search or filter." /> : <EmptyState title="No urgent work in the queue" description="When care records age, transfer files go missing, documents need approval, or buyers need follow-up, the work will land here." />}
      </section>

      <div className="ops-workspace ops-workspace--columns">
        {(['Care', 'Ownership', 'Documents', 'Sales'] as ReminderKind[]).map((kind) => {
          const count = reminders.filter((reminder) => reminder.kind === kind).length;
          return <Panel key={kind} title={kind} meta={<Pill tone={count ? 'blue' : 'slate'}>{count}</Pill>}><p className="ops-panel-copy">{kindCopy(kind)}</p><button className="button button--ghost button--compact" type="button" onClick={() => setFilter(kind)}>Show {kind.toLowerCase()}</button></Panel>;
        })}
      </div>
    </div>
  );
}

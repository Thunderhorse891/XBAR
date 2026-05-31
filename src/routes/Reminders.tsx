import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { formatDateLabel } from '@/lib/format';
import { useXbarStore } from '@/store/useXbarStore';
import './operationsExperience.css';

import { kindCopy, urgencyTone } from '@/features/reminders/helpers';
import type { ReminderFilter, ReminderItem, ReminderKind, ReminderUrgency } from '@/features/reminders/types';

export default function Reminders() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const [filter, setFilter] = useState<ReminderFilter>('All');
  const [query, setQuery] = useState('');

  const reminders = useMemo<ReminderItem[]>(() => {
    const careBoard = buildCareBoardRows(horses, documents, expenseReceipts);
    const transferGaps = buildTransferGapRows(horses, ownershipRecords, documents);
    const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
    const buyerFollowUps = salesLeads.filter((lead) => lead.stage !== 'Closed');

    return [
      ...careBoard.flatMap((row) =>
        row.signals
          .filter((signal) => signal.status !== 'clear')
          .map((signal) => ({
            id: `care-${row.horseId}-${signal.key}`,
            kind: 'Care' as const,
            urgency: signal.status === 'due' ? 'Due' as const : 'Watch' as const,
            title: `${signal.label} for ${row.horseName}`,
            horseId: row.horseId,
            horseName: row.horseName,
            dueDate: signal.dueDate,
            detail: signal.detail,
            route: `/horses/${row.horseId}`,
          })),
      ),
      ...transferGaps.map((gap) => ({
        id: `transfer-${gap.horseId}`,
        kind: 'Ownership' as const,
        urgency: 'Due' as const,
        title: `Transfer file for ${gap.horseName}`,
        horseId: gap.horseId,
        horseName: gap.horseName,
        dueDate: gap.dueDate,
        detail: gap.reasons.slice(0, 3).join(', '),
        route: '/ownership',
      })),
      ...reviewQueue.map((document) => ({
        id: `document-${document.id}`,
        kind: 'Documents' as const,
        urgency: document.state === 'Needs Review' ? 'Due' as const : 'Watch' as const,
        title: document.title,
        horseId: document.horseId,
        horseName: document.entities.horseName,
        dueDate: document.uploadedAt,
        detail: document.horseId ? 'Approve or archive this matched file.' : 'Assign this file to a horse before it becomes trusted record proof.',
        route: '/documents',
      })),
      ...buyerFollowUps.map((lead) => {
        const horse = horses.find((item) => item.id === lead.horseId);
        return {
          id: `sale-${lead.id}`,
          kind: 'Sales' as const,
          urgency: lead.stage === 'Offer' || lead.stage === 'Qualified' ? 'Watch' as const : 'Clear' as const,
          title: `${lead.name} follow-up`,
          horseId: lead.horseId,
          horseName: horse?.name,
          dueDate: lead.nextFollowUp ?? lead.lastTouch,
          detail: `${horse?.name ?? 'Horse pending'} | ${lead.channel} | ${lead.stage}`,
          route: '/sales',
        };
      }),
    ].sort((left, right) => {
      const urgencyRank = { Due: 0, Watch: 1, Clear: 2 } satisfies Record<ReminderUrgency, number>;
      const urgencyDelta = urgencyRank[left.urgency] - urgencyRank[right.urgency];
      if (urgencyDelta) return urgencyDelta;
      return Date.parse(left.dueDate || '9999-12-31') - Date.parse(right.dueDate || '9999-12-31');
    });
  }, [documents, expenseReceipts, horses, ownershipRecords, salesLeads]);

  const filteredReminders = reminders.filter((reminder) => {
    const normalized = query.trim().toLowerCase();
    const haystack = [reminder.title, reminder.kind, reminder.urgency, reminder.horseName, reminder.detail].filter(Boolean).join(' ').toLowerCase();
    return (filter === 'All' || reminder.kind === filter) && (!normalized || haystack.includes(normalized));
  });

  const dueCount = reminders.filter((reminder) => reminder.urgency === 'Due').length;
  const watchCount = reminders.filter((reminder) => reminder.urgency === 'Watch').length;
  const careCount = reminders.filter((reminder) => reminder.kind === 'Care').length;
  const ownershipCount = reminders.filter((reminder) => reminder.kind === 'Ownership').length;
  const filters: ReminderFilter[] = ['All', 'Care', 'Ownership', 'Documents', 'Sales'];

  return (
    <div className="ops-experience">
      <section className="ops-hero ops-hero--reminders" aria-labelledby="reminders-title">
        <div>
          <div className="ops-kicker">Reminders</div>
          <h1 id="reminders-title">What needs attention right now</h1>
          <p>Coggins expiring, vaccines due, transfer papers missing, documents waiting review, and buyer follow-ups — all in one place.</p>
          <div className="ops-hero__actions">
            <button className="button button--primary" type="button" onClick={() => navigate('/medical')}>Open health</button>
            <button className="button button--ghost" type="button" onClick={() => navigate('/ownership')}>Open ownership</button>
          </div>
        </div>
        <div className="ops-hero__ledger" aria-label="Reminder summary">
          <span>Open work</span>
          <strong>{reminders.length}</strong>
          <small>{dueCount} due now | {watchCount} on watch</small>
          <div className="ops-hero__mini-grid">
            <div><span>Care</span><b>{careCount}</b></div>
            <div><span>Transfer</span><b>{ownershipCount}</b></div>
          </div>
        </div>
      </section>

      <div className="ops-metric-grid">
        <MetricCard label="Due" value={String(dueCount)} detail="Needs attention first" tone={dueCount ? 'rose' : 'emerald'} className="ops-metric-card" />
        <MetricCard label="Watch" value={String(watchCount)} detail="Not urgent, not ignored" tone={watchCount ? 'amber' : 'emerald'} className="ops-metric-card" />
        <MetricCard label="Care" value={String(careCount)} detail="Health and care tasks" tone="blue" className="ops-metric-card" />
        <MetricCard label="Ownership" value={String(ownershipCount)} detail="Transfer and proof work" tone="slate" className="ops-metric-card" />
      </div>

      <section className="ops-panel">
        <div className="ops-section-heading">
          <div>
            <span className="section-eyebrow">Attention needed</span>
            <h2>What needs attention</h2>
          </div>
          <Pill tone="blue">{filteredReminders.length} shown</Pill>
        </div>

        <div className="ops-toolbar ops-toolbar--wide">
          <label className="ops-search">
            <span className="sr-only">Search reminders</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search horse, document, transfer, buyer..." />
          </label>
          <select value={filter} onChange={(event) => setFilter(event.target.value as ReminderFilter)} aria-label="Filter reminder type">
            {filters.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        {filteredReminders.length ? (
          <div className="ops-timeline-list">
            {filteredReminders.map((reminder) => (
              <div key={reminder.id} className="ops-timeline-item" style={{ cursor: 'default' }}>
                <span className={`ops-timeline-dot ops-timeline-dot--${reminder.urgency.toLowerCase()}`} />
                <div style={{ flex: 1 }}>
                  <div className="ops-timeline-item__top">
                    <strong>{reminder.title}</strong>
                    <Pill tone={urgencyTone(reminder.urgency)}>{reminder.urgency}</Pill>
                  </div>
                  <p>{reminder.detail}</p>
                  <div className="ops-record-meta">
                    <span>{reminder.kind}</span>
                    <span>{reminder.horseName ?? 'Workspace'}</span>
                    <span>{reminder.dueDate ? formatDateLabel(reminder.dueDate) : 'No date'}</span>
                  </div>
                  <div className="inline-actions" style={{ marginTop: '10px' }}>
                    {reminder.kind === 'Care' && reminder.horseId && (
                      <button className="button button--primary button--compact" type="button" onClick={() => navigate(`/medical?horse=${reminder.horseId}`)}>Add care event</button>
                    )}
                    {reminder.kind === 'Ownership' && (
                      <button className="button button--primary button--compact" type="button" onClick={() => navigate('/ownership')}>Review transfer</button>
                    )}
                    {reminder.kind === 'Documents' && (
                      <button className="button button--primary button--compact" type="button" onClick={() => navigate('/documents')}>Review document</button>
                    )}
                    {reminder.kind === 'Sales' && (
                      <button className="button button--primary button--compact" type="button" onClick={() => navigate('/sales')}>Open lead</button>
                    )}
                    {reminder.horseId && (
                      <button className="button button--ghost button--compact" type="button" onClick={() => navigate(`/horses/${reminder.horseId}`)}>View horse</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : reminders.length ? (
          <EmptyState compact title="No reminders match" description="Adjust the search or filter." />
        ) : (
          <EmptyState title="No urgent work in the queue" description="When care records age, transfer files go missing, documents need approval, or buyers need follow-up, the work will land here." />
        )}
      </section>

      <div className="ops-workspace ops-workspace--columns">
        {(['Care', 'Ownership', 'Documents', 'Sales'] as ReminderKind[]).map((kind) => {
          const count = reminders.filter((reminder) => reminder.kind === kind).length;
          return (
            <Panel key={kind} title={kind} meta={<Pill tone={count ? 'blue' : 'slate'}>{count}</Pill>}>
              <p className="ops-panel-copy">{kindCopy(kind)}</p>
              <button className="button button--ghost button--compact" type="button" onClick={() => setFilter(kind)}>Show {kind.toLowerCase()}</button>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

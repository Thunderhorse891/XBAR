import type { CareBoardRow, TransferGapRow } from './dashboardOps.js';
import type { DocumentRecord, SalesLead } from '../types/xbar.js';
import type { ReminderItem, ReminderUrgency } from '../features/reminders/types.js';

export type OperationsPriorityItem = ReminderItem & {
  score: number;
  timing: 'Overdue' | 'Today' | 'This week' | 'Later' | 'Unscheduled';
};

export type OperationsPrioritySummary = {
  items: OperationsPriorityItem[];
  top: OperationsPriorityItem[];
  dueCount: number;
  watchCount: number;
  overdueCount: number;
  thisWeekCount: number;
};

type PriorityInput = {
  careRows: CareBoardRow[];
  transferRows: TransferGapRow[];
  documents: DocumentRecord[];
  salesLeads: SalesLead[];
  horseNames: Record<string, string>;
};

const dayMs = 24 * 60 * 60 * 1000;
const urgencyRank: Record<ReminderUrgency, number> = { Due: 0, Watch: 1, Clear: 2 };

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function dateOffset(dueDate: string | undefined, now: Date) {
  if (!dueDate) return null;
  const parsed = new Date(dueDate.includes('T') ? dueDate : `${dueDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.round((startOfDay(parsed).getTime() - startOfDay(now).getTime()) / dayMs);
}

function timingFor(dueDate: string | undefined, now: Date): OperationsPriorityItem['timing'] {
  const offset = dateOffset(dueDate, now);
  if (offset === null) return 'Unscheduled';
  if (offset < 0) return 'Overdue';
  if (offset === 0) return 'Today';
  if (offset <= 7) return 'This week';
  return 'Later';
}

function scoreFor(urgency: ReminderUrgency, dueDate: string | undefined, now: Date, bonus = 0) {
  const offset = dateOffset(dueDate, now);
  const dateScore = offset === null ? 0 : offset < 0 ? Math.min(30, Math.abs(offset)) : Math.max(0, 8 - offset);
  return (urgency === 'Due' ? 100 : urgency === 'Watch' ? 60 : 10) + dateScore + bonus;
}

function withPriority(item: ReminderItem, now: Date, bonus = 0): OperationsPriorityItem {
  return { ...item, timing: timingFor(item.dueDate, now), score: scoreFor(item.urgency, item.dueDate, now, bonus) };
}

export function buildOperationsPriorities(input: PriorityInput, now = new Date()): OperationsPrioritySummary {
  const items: OperationsPriorityItem[] = [
    ...input.careRows.flatMap((row) => row.signals.filter((signal) => signal.status !== 'clear').map((signal) => withPriority({
      id: `care-${row.horseId}-${signal.key}`,
      kind: 'Care',
      urgency: signal.status === 'due' ? 'Due' : 'Watch',
      title: `${signal.label} for ${row.horseName}`,
      horseId: row.horseId,
      horseName: row.horseName,
      dueDate: signal.dueDate,
      detail: signal.detail,
      route: `/medical?horse=${row.horseId}`,
    }, now, signal.status === 'due' ? 8 : 0))),
    ...input.transferRows.map((gap) => withPriority({
      id: `transfer-${gap.horseId}`,
      kind: 'Ownership',
      urgency: 'Due',
      title: `Complete transfer file for ${gap.horseName}`,
      horseId: gap.horseId,
      horseName: gap.horseName,
      dueDate: gap.dueDate,
      detail: gap.reasons.slice(0, 3).join(', '),
      route: '/ownership',
    }, now, 14)),
    ...input.documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched').map((document) => withPriority({
      id: `document-${document.id}`,
      kind: 'Documents',
      urgency: document.state === 'Needs Review' ? 'Due' : 'Watch',
      title: document.title,
      horseId: document.horseId,
      horseName: document.entities.horseName,
      dueDate: document.uploadedAt,
      detail: document.horseId ? 'Approve or archive this matched file.' : 'Assign this file to a horse before it becomes trusted record proof.',
      route: '/documents',
    }, now, document.state === 'Needs Review' ? 6 : 0)),
    ...input.salesLeads.filter((lead) => lead.stage !== 'Closed').map((lead) => {
      const offset = dateOffset(lead.nextFollowUp, now);
      const urgency: ReminderUrgency = offset !== null && offset <= 0 ? 'Due' : offset !== null && offset <= 7 ? 'Watch' : lead.stage === 'Offer' || lead.stage === 'Qualified' ? 'Watch' : 'Clear';
      const horseName = input.horseNames[lead.horseId];
      return withPriority({
        id: `sale-${lead.id}`,
        kind: 'Sales',
        urgency,
        title: `${lead.name} follow-up`,
        horseId: lead.horseId,
        horseName,
        dueDate: lead.nextFollowUp ?? lead.lastTouch,
        detail: `${horseName ?? 'Horse pending'} | ${lead.channel} | ${lead.stage}`,
        route: '/sales',
      }, now, lead.stage === 'Offer' ? 12 : 0);
    }),
  ].sort((left, right) => urgencyRank[left.urgency] - urgencyRank[right.urgency] || right.score - left.score || Date.parse(left.dueDate || '9999-12-31') - Date.parse(right.dueDate || '9999-12-31'));

  return {
    items,
    top: items.filter((item) => item.urgency !== 'Clear').slice(0, 3),
    dueCount: items.filter((item) => item.urgency === 'Due').length,
    watchCount: items.filter((item) => item.urgency === 'Watch').length,
    overdueCount: items.filter((item) => item.timing === 'Overdue').length,
    thisWeekCount: items.filter((item) => item.timing === 'Today' || item.timing === 'This week').length,
  };
}

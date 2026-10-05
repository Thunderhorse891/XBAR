import type { DocumentRecord, ExpenseReceipt, HorseRecord, OwnershipRecord, SalesLead } from '../types/xbar.js';
import { documentsStageUrl } from '../features/documents/pipeline.js';
import { buyerFollowUpPath } from './buyerRoutes.js';
import { buildCareBoardRows, buildTransferGapRows } from './dashboardOps.js';
import { localIsoDate } from './format.js';
import { sha256 } from './sha256.js';
import { isCalendarDay } from './taskDeferrals.js';

export type CareTaskCategory = 'Documents' | 'Care' | 'Sales';
export type CareTask = {
  id: string;
  revision: string;
  title: string;
  detail: string;
  category: CareTaskCategory;
  priority: 'Blocker' | 'High' | 'Normal';
  linkedName: string;
  actionLabel: string;
  to: string;
  due: string;
};

export function buildCareTasks(
  input: {
    horses: HorseRecord[];
    documents: DocumentRecord[];
    ownershipRecords: OwnershipRecord[];
    expenseReceipts: ExpenseReceipt[];
    salesLeads: SalesLead[];
    segment?: string;
  },
  now = new Date(),
): CareTask[] {
  const { documents, ownershipRecords, expenseReceipts, salesLeads, segment } = input;
  const horses = input.horses.filter((horse) => !horse.archive && (!segment || horse.segment === segment));
  const selected = new Set(horses.map((horse) => horse.id));
  const archived = new Set(input.horses.filter((horse) => horse.archive).map((horse) => horse.id));
  const inScope = (horseId?: string) =>
    segment ? Boolean(horseId && selected.has(horseId)) : !archived.has(horseId ?? '');
  const out: CareTask[] = [];
  const add = (task: Omit<CareTask, 'revision'>, source: unknown) =>
    out.push({ ...task, revision: sha256(JSON.stringify(source)) });
  buildTransferGapRows(horses, ownershipRecords, documents).forEach((gap) =>
    add(
      {
        id: `gap-${gap.horseId}`,
        title: `Finish ownership documents — ${gap.horseName}`,
        detail: gap.reasons.join(' · ') || 'Missing transfer documents',
        category: 'Documents',
        priority: 'Blocker',
        linkedName: gap.horseName,
        actionLabel: 'Open horse record',
        to: `/horses/${encodeURIComponent(gap.horseId)}`,
        due: gap.dueDate || 'Now',
      },
      [gap.dueDate, gap.transferStatus, [...gap.reasons].sort()],
    ),
  );
  buildCareBoardRows(horses, documents, expenseReceipts, now).forEach((row) => {
    const due = row.signals.filter((signal) => signal.status === 'due');
    if (!due.length) return;
    add(
      {
        id: `care-${row.horseId}`,
        title: `Care due — ${row.horseName}`,
        detail: due.map((signal) => signal.label).join(' · '),
        category: 'Care',
        priority: 'High',
        linkedName: row.horseName,
        actionLabel: 'Open horse record',
        to: `/horses/${encodeURIComponent(row.horseId)}`,
        due: due[0].dueDate ?? 'Today',
      },
      due.map((signal) => [signal.key, signal.dueDate ?? '', signal.detail]),
    );
  });
  documents
    .filter((document) => inScope(document.horseId) && ['Needs Review', 'Queued', 'Matched'].includes(document.state))
    .forEach((document) =>
      add(
        {
          id: `doc-${document.id}`,
          title: `${document.state === 'Queued' ? 'Check processing' : 'Review document'} — ${document.title}`,
          detail: `${document.type} ${document.state === 'Queued' ? 'waiting for text extraction' : 'waiting to be checked'}`,
          category: 'Documents',
          priority: 'Normal',
          linkedName: document.title,
          actionLabel: document.state === 'Queued' ? 'Open processing' : 'Review documents',
          to: `${documentsStageUrl(document.state === 'Queued' ? 'Processing' : 'Review')}${document.horseId ? `&horse=${encodeURIComponent(document.horseId)}` : ''}`,
          due: 'Today',
        },
        [document.state, document.horseId, document.uploadedAt, document.entities],
      ),
    );
  const today = localIsoDate(now);
  salesLeads
    .filter(
      (lead) =>
        inScope(lead.horseId) &&
        lead.stage !== 'Closed' &&
        lead.nextFollowUp &&
        isCalendarDay(lead.nextFollowUp) &&
        lead.nextFollowUp <= today,
    )
    .forEach((lead) =>
      add(
        {
          id: `lead-${lead.id}`,
          title: `Follow up with ${lead.name}`,
          detail: lead.notes || 'Buyer follow-up',
          category: 'Sales',
          priority: 'Normal',
          linkedName: lead.name,
          actionLabel: 'Open buyer follow-up',
          to: buyerFollowUpPath(lead.id),
          due: lead.nextFollowUp!,
        },
        [lead.horseId, lead.nextFollowUp, lead.lastTouch, lead.stage, lead.notes],
      ),
    );
  return out;
}

import { buildCareBoardRows, buildTransferGapRows } from './dashboardOps.js';
import { buildOperationsPriorities, type OperationsPriorityItem } from './operationsPriority.js';
import { buildSaleHold } from './saleTrustEngine.js';
import type {
  DocumentRecord,
  ExpenseReceipt,
  HorseRecord,
  OwnershipRecord,
  SalesLead,
  SharedListingRecord,
  WorkspaceProfile,
} from '../types/xbar.js';
import type { TaskPriority, WorkCategory, WorkLinkedType, WorkTask } from '../types/saas.js';

export const workboardTabs = ['All', 'Overdue', 'Setup', 'Animal Care', 'Ownership', 'Documents', 'Sales', 'Equipment'] as const;

type TodayWorkInput = {
  horses: HorseRecord[];
  documents: DocumentRecord[];
  ownershipRecords: OwnershipRecord[];
  expenseReceipts: ExpenseReceipt[];
  salesLeads: SalesLead[];
  sharedListings: SharedListingRecord[];
  workspaceProfile: WorkspaceProfile;
  now?: Date;
};

function assignee(profile: WorkspaceProfile) {
  return profile.ranchManagerName || profile.defaultOwnerName || profile.businessName || 'Ranch staff';
}

function dueLabel(item: OperationsPriorityItem) {
  if (item.timing === 'Overdue') return 'Overdue';
  if (item.timing === 'Today') return 'Today';
  if (item.timing === 'This week') return 'This week';
  if (item.timing === 'Later') return item.dueDate ? new Date(item.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Later';
  return 'Unscheduled';
}

function priorityFor(item: OperationsPriorityItem): TaskPriority {
  if (item.urgency === 'Due') return 'High';
  if (item.urgency === 'Watch') return 'Medium';
  return 'Normal';
}

function categoryFor(item: OperationsPriorityItem): WorkCategory {
  if (item.kind === 'Care') return 'Animal Care';
  if (item.kind === 'Ownership') return 'Ownership';
  if (item.kind === 'Documents') return 'Documents';
  if (item.kind === 'Sales') return 'Sales';
  return 'Setup';
}

function linkedTypeFor(item: OperationsPriorityItem): WorkLinkedType {
  if (item.kind === 'Documents') return 'Document';
  if (item.kind === 'Ownership') return 'Ownership';
  if (item.horseId) return 'Animal';
  return 'Workspace';
}

function priorityItemToTask(item: OperationsPriorityItem, profile: WorkspaceProfile): WorkTask {
  return {
    id: item.id,
    title: item.title,
    linkedType: linkedTypeFor(item),
    linkedName: item.horseName || item.kind,
    priority: priorityFor(item),
    assignee: assignee(profile),
    due: dueLabel(item),
    status: item.urgency === 'Due' ? 'Open' : 'Review',
    category: categoryFor(item),
    detail: item.detail,
    route: item.route,
    source: 'Operations Priority',
    overdue: item.timing === 'Overdue',
  };
}

function setupTasks(input: TodayWorkInput): WorkTask[] {
  const owner = assignee(input.workspaceProfile);
  const tasks: WorkTask[] = [];

  if (!input.horses.length) {
    tasks.push({
      id: 'setup-add-first-animal',
      title: 'Add the first animal record',
      linkedType: 'Workspace',
      linkedName: input.workspaceProfile.ranchName || 'New workspace',
      priority: 'High',
      assignee: owner,
      due: 'Now',
      status: 'Open',
      category: 'Setup',
      detail: 'Start the operating record that documents, care, ownership, and buyer activity connect to.',
      route: '/horses',
      source: 'Workspace Setup',
    });
  }

  if (input.horses.length > 0 && input.documents.filter((document) => document.state !== 'Archived').length === 0) {
    tasks.push({
      id: 'setup-upload-first-document',
      title: 'Attach the first source document',
      linkedType: 'Document',
      linkedName: input.horses[0]?.name ?? 'Horse record',
      priority: 'High',
      assignee: owner,
      due: 'Today',
      status: 'Open',
      category: 'Documents',
      detail: 'Upload registration, Coggins, health, or ownership proof so the horse record has trusted source material.',
      route: `/documents?upload=1&horse=${input.horses[0]?.id ?? ''}`,
      source: 'Workspace Setup',
    });
  }

  if (input.horses.length > 0 && input.expenseReceipts.length === 0) {
    tasks.push({
      id: 'setup-log-first-receipt',
      title: 'Log the first operating receipt',
      linkedType: 'Workspace',
      linkedName: 'Operating ledger',
      priority: 'Normal',
      assignee: owner,
      due: 'This week',
      status: 'Planned',
      category: 'Setup',
      detail: 'A receipt connects the ranch ledger to real operating margin instead of an empty dashboard.',
      route: '/expenses',
      source: 'Workspace Setup',
    });
  }

  if (input.horses.length > 0 && input.sharedListings.length === 0 && input.salesLeads.length === 0) {
    tasks.push({
      id: 'setup-prepare-first-sale-workflow',
      title: 'Prepare the first controlled buyer workflow',
      linkedType: 'Sale Packet',
      linkedName: input.horses[0]?.name ?? 'Sale prospect',
      priority: 'Normal',
      assignee: owner,
      due: 'This week',
      status: 'Planned',
      category: 'Sales',
      detail: 'Create a controlled listing or buyer-ready packet from a real horse record when the documents are ready.',
      route: '/sales',
      source: 'Workspace Setup',
    });
  }

  return tasks;
}

function saleHoldRoute(reason: string, horseId: string) {
  const lower = reason.toLowerCase();
  if (lower.includes('ownership') || lower.includes('transfer') || lower.includes('registry') || lower.includes('legal-owner')) return '/ownership';
  if (lower.includes('coggins') || lower.includes('proof')) return `/documents?upload=1&horse=${horseId}`;
  if (lower.includes('medical')) return `/medical?horse=${horseId}`;
  return `/horses/${horseId}`;
}

function saleHoldTasks(input: TodayWorkInput, now: Date): WorkTask[] {
  return input.horses.flatMap((horse) => {
    const hold = buildSaleHold(
      horse,
      input.documents,
      input.ownershipRecords.find((record) => record.horseId === horse.id),
      now,
    );

    if (!hold.held || horse.sale.listingState === 'Private') return [];

    const firstReason = hold.reasons[0] ?? 'Sale release is blocked.';
    return [{
      id: `sale-hold-${horse.id}`,
      title: `Clear sale release blockers for ${horse.name}`,
      linkedType: 'Sale Packet',
      linkedName: horse.name,
      priority: 'Revenue Blocker',
      assignee: assignee(input.workspaceProfile),
      due: 'Now',
      status: 'Blocking Release',
      category: 'Sales',
      detail: firstReason,
      route: saleHoldRoute(firstReason, horse.id),
      source: 'Sale Hold',
      overdue: true,
      blocker: {
        horseId: horse.id,
        reasons: hold.reasons,
        nextAction: firstReason,
        amount: horse.sale.askPrice || undefined,
      },
    } satisfies WorkTask];
  });
}

function sortTasks(left: WorkTask, right: WorkTask) {
  const priorityRank: Record<TaskPriority, number> = { 'Revenue Blocker': 0, High: 1, Medium: 2, Normal: 3, Planned: 4 };
  const dueRank = (task: WorkTask) => task.due === 'Now' ? 0 : task.due === 'Overdue' ? 1 : task.due === 'Today' ? 2 : task.due === 'This week' ? 3 : 4;
  return priorityRank[left.priority] - priorityRank[right.priority] || dueRank(left) - dueRank(right) || left.title.localeCompare(right.title);
}

export function buildTodayWork(input: TodayWorkInput): WorkTask[] {
  const now = input.now ?? new Date();
  const horseNames = Object.fromEntries(input.horses.map((horse) => [horse.id, horse.name]));
  const priorities = buildOperationsPriorities({
    careRows: buildCareBoardRows(input.horses, input.documents, input.expenseReceipts, now),
    transferRows: buildTransferGapRows(input.horses, input.ownershipRecords, input.documents),
    documents: input.documents,
    salesLeads: input.salesLeads,
    horseNames,
  }, now);

  const allTasks = [
    ...setupTasks(input),
    ...saleHoldTasks(input, now),
    ...priorities.items.filter((item) => item.urgency !== 'Clear').map((item) => priorityItemToTask(item, input.workspaceProfile)),
  ];

  const byId = new Map<string, WorkTask>();
  allTasks.forEach((task) => byId.set(task.id, task));
  return [...byId.values()].sort(sortTasks);
}

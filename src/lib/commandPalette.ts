// Universal command-palette index and search.
//
// The palette (⌘K / Ctrl+K) is XBAR's fast path to everything a rancher has in
// the workspace — not just navigation. This module is the pure, framework-free
// core: it turns the live store into a flat, ranked, grouped index so the React
// shell stays a thin renderer and the ranking is unit-testable.
//
// Everything indexed here is real workspace data. Nothing is invented: people
// are derived from the owners already on horse records and ownership transfers,
// expenses from logged receipts, and so on.

// The lib depends only on the handful of fields it actually reads, declared as
// minimal structural shapes rather than Pick<> of the full store records. This
// keeps the palette decoupled from unrelated record churn; the real HorseRecord,
// DocumentRecord, etc. structurally satisfy these at the call site.
export interface HorseLike {
  id: string;
  name: string;
  segment: string;
  breed: string;
  registrationNumber: string;
  owner: string;
  location: { barn?: string };
}
export interface DocumentLike {
  id: string;
  title: string;
  type: string;
  state: string;
}
export interface SalesLeadLike {
  id: string;
  name: string;
  stage: string;
}
export interface ExpenseLike {
  id: string;
  title: string;
  vendor: string;
  category: string;
  amount: number;
}
export interface OwnershipLike {
  id: string;
  legalOwner: string;
  horseId: string;
}

export type CommandGroup = 'Navigate' | 'Horses' | 'People' | 'Documents' | 'Buyers' | 'Expenses';

// Groups render in this order; it also decides which results a rancher sees
// first when a query matches across categories.
export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  'Navigate',
  'Horses',
  'People',
  'Documents',
  'Buyers',
  'Expenses',
];

export interface CommandEntry {
  id: string;
  label: string;
  /** Secondary line shown under the label. */
  detail: string;
  /** Route to navigate to when the entry is chosen. */
  path: string;
  group: CommandGroup;
  /** Extra searchable text (registration numbers, vendors, breeds) not shown. */
  keywords: string;
}

export interface CommandSearchGroup {
  group: CommandGroup;
  items: CommandEntry[];
}

// Static navigation targets — always available, even in an empty workspace.
export const ROUTE_COMMANDS: readonly CommandEntry[] = (
  [
    ['dashboard', 'Home', 'Daily ranch operations', '/'],
    ['horses', 'Horse registry', 'All horse records', '/horses'],
    ['documents', 'Documents', 'Source records and review', '/documents'],
    ['ownership', 'Ownership', 'Transfers and documents', '/ownership'],
    ['medical', 'Health', 'Care records and due work', '/medical'],
    ['breeding', 'Breeding pipeline', 'Pairings and milestones', '/breeding'],
    ['sales', 'Sales', 'Buyer pipeline and listings', '/sales'],
    ['expenses', 'Expenses', 'Receipts and cost tracking', '/expenses'],
    ['reminders', 'Tasks and reminders', 'Daily work queue', '/reminders'],
    ['assets', 'Property and equipment', 'Ranch assets and supplies', '/assets'],
  ] as const
).map(([id, label, detail, path]) => ({ id, label, detail, path, group: 'Navigate' as const, keywords: '' }));

export interface CommandSources {
  horses: HorseLike[];
  documents: DocumentLike[];
  salesLeads: SalesLeadLike[];
  expenseReceipts: ExpenseLike[];
  ownershipRecords: OwnershipLike[];
  /** Route to a buyer's follow-up view; injected so the lib stays route-agnostic. */
  buyerPath: (leadId: string) => string;
}

const MAX_DOCUMENTS = 60;
const MAX_EXPENSES = 40;

function formatUsd(amount: number): string {
  const rounded = Math.max(0, Math.round(Number(amount) || 0));
  return `$${rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function personKey(name: string): string {
  return name.trim().toLowerCase();
}

// Build the People group from the owners already present on horse records and
// ownership transfers, counting distinct horses per person so the detail line
// ("caretaker of N horses") reflects real holdings rather than row counts.
function buildPeopleEntries(horses: HorseLike[], ownershipRecords: OwnershipLike[]): CommandEntry[] {
  const horsesByPerson = new Map<string, { name: string; horseIds: Set<string> }>();

  const add = (rawName: string, horseId: string) => {
    const name = rawName.trim();
    if (!name) return;
    const key = personKey(name);
    const existing = horsesByPerson.get(key);
    if (existing) {
      if (horseId) existing.horseIds.add(horseId);
    } else {
      horsesByPerson.set(key, { name, horseIds: new Set(horseId ? [horseId] : []) });
    }
  };

  for (const horse of horses) add(horse.owner, horse.id);
  for (const record of ownershipRecords) add(record.legalOwner, record.horseId);

  return [...horsesByPerson.values()].map(({ name, horseIds }) => {
    const count = horseIds.size;
    return {
      id: `person-${personKey(name).replace(/[^a-z0-9]+/g, '-')}`,
      label: name,
      detail: count === 1 ? 'Owner · 1 horse' : `Owner · ${count} horses`,
      path: '/ownership',
      group: 'People' as const,
      keywords: 'owner buyer contact person',
    };
  });
}

/** Flatten the live workspace into a single searchable index. Pure. */
export function buildCommandEntries(sources: CommandSources): CommandEntry[] {
  const { horses, documents, salesLeads, expenseReceipts, ownershipRecords, buyerPath } = sources;

  const horseEntries: CommandEntry[] = horses.map((horse) => ({
    id: `horse-${horse.id}`,
    label: horse.name,
    detail: [horse.segment, horse.location?.barn].filter(Boolean).join(' · ') || 'Horse record',
    path: `/horses/${horse.id}`,
    group: 'Horses',
    keywords: [horse.breed, horse.registrationNumber].filter(Boolean).join(' '),
  }));

  const documentEntries: CommandEntry[] = documents.slice(0, MAX_DOCUMENTS).map((document) => ({
    id: `document-${document.id}`,
    label: document.title,
    detail: `${document.type} · ${document.state}`,
    path: '/documents',
    group: 'Documents',
    keywords: `${document.type} ${document.state}`,
  }));

  const buyerEntries: CommandEntry[] = salesLeads.map((lead) => ({
    id: `lead-${lead.id}`,
    label: lead.name,
    detail: `${lead.stage} buyer`,
    path: buyerPath(lead.id),
    group: 'Buyers',
    keywords: `${lead.stage} buyer prospect`,
  }));

  const expenseEntries: CommandEntry[] = expenseReceipts.slice(0, MAX_EXPENSES).map((expense) => ({
    id: `expense-${expense.id}`,
    label: expense.title,
    detail: `${expense.category} · ${expense.vendor || 'No vendor'} · ${formatUsd(expense.amount)}`,
    path: '/expenses',
    group: 'Expenses',
    keywords: `${expense.category} ${expense.vendor} receipt cost`,
  }));

  return [
    ...ROUTE_COMMANDS,
    ...horseEntries,
    ...buildPeopleEntries(horses, ownershipRecords),
    ...documentEntries,
    ...buyerEntries,
    ...expenseEntries,
  ];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Lower is a better match. Label hits always beat metadata hits, and an exact /
// prefix / word-start label match is preferred in that order, so typing "war"
// surfaces the horse "Warrior" above a document that merely mentions "warranty".
export function scoreCommandEntry(entry: CommandEntry, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const label = entry.label.toLowerCase();
  if (label === normalizedQuery) return 0;
  if (label.startsWith(normalizedQuery)) return 1;
  if (new RegExp(`\\b${escapeRegExp(normalizedQuery)}`).test(label)) return 2;
  if (label.includes(normalizedQuery)) return 3;
  if (`${entry.detail} ${entry.keywords}`.toLowerCase().includes(normalizedQuery)) return 4;
  return Number.POSITIVE_INFINITY;
}

export interface SearchOptions {
  /** Max results shown per group. */
  limitPerGroup?: number;
  /** Groups shown (in order) when the query is empty. */
  emptyStateGroups?: readonly CommandGroup[];
}

// Rank and group entries for a query. An empty query returns the navigation
// group so the palette opens to a useful default rather than a blank sheet.
export function searchCommandEntries(
  entries: CommandEntry[],
  rawQuery: string,
  options: SearchOptions = {},
): CommandSearchGroup[] {
  const { limitPerGroup = 6, emptyStateGroups = ['Navigate'] } = options;
  const normalized = rawQuery.trim().toLowerCase();

  const byGroup = new Map<CommandGroup, { entry: CommandEntry; score: number; order: number }[]>();
  const push = (entry: CommandEntry, score: number, order: number) => {
    const bucket = byGroup.get(entry.group);
    if (bucket) bucket.push({ entry, score, order });
    else byGroup.set(entry.group, [{ entry, score, order }]);
  };

  entries.forEach((entry, order) => {
    if (!normalized) {
      if (emptyStateGroups.includes(entry.group)) push(entry, 0, order);
      return;
    }
    const score = scoreCommandEntry(entry, normalized);
    if (Number.isFinite(score)) push(entry, score, order);
  });

  const groups = normalized ? COMMAND_GROUP_ORDER : emptyStateGroups;
  const result: CommandSearchGroup[] = [];
  for (const group of groups) {
    const ranked = byGroup.get(group);
    if (!ranked || ranked.length === 0) continue;
    ranked.sort((a, b) => a.score - b.score || a.order - b.order);
    result.push({ group, items: ranked.slice(0, limitPerGroup).map((row) => row.entry) });
  }
  return result;
}

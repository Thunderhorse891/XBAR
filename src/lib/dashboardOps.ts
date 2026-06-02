import type { DocumentRecord, ExpenseCategory, ExpenseReceipt, HorseRecord, OwnershipRecord } from '../types/xbar.js';

type CareSignalStatus = 'due' | 'watch' | 'clear';

export type TransferGapRow = {
  horseId: string;
  horseName: string;
  transferStatus: OwnershipRecord['transferStatus'];
  dueDate: string;
  pendingCount: number;
  reasons: string[];
};

export type CareSignal = {
  key: 'wormer' | 'dental' | 'coggins';
  label: 'Wormer' | 'Dental Float' | 'Coggins';
  status: CareSignalStatus;
  detail: string;
  dueDate?: string;
};

export type CareBoardRow = {
  horseId: string;
  horseName: string;
  signals: CareSignal[];
  priority: number;
};

export type BudgetCategoryTotal = {
  category: ExpenseCategory;
  amount: number;
};

export type BudgetSummary = {
  total: number;
  feed: number;
  health: number;
  receiptCount: number;
  monthKey: string;
  categories: BudgetCategoryTotal[];
  latestReceipts: ExpenseReceipt[];
};

const dayMs = 24 * 60 * 60 * 1000;

function parseDate(value?: string) {
  if (!value?.trim()) {
    return null;
  }

  const parsed = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function diffDays(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / dayMs);
}

function buildMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function latestReceiptForCategory(receipts: ExpenseReceipt[], horseId: string, category: ExpenseCategory) {
  return receipts
    .filter((receipt) => receipt.horseId === horseId && receipt.category === category)
    .sort((left, right) => Date.parse(right.receiptDate) - Date.parse(left.receiptDate))[0];
}

function latestCogginsDocument(documents: DocumentRecord[], horseId: string) {
  return documents
    .filter((document) => document.horseId === horseId && document.type === 'Coggins' && document.state === 'Ready')
    .sort((left, right) => {
      const leftDate = left.entities.examDate ?? left.uploadedAt;
      const rightDate = right.entities.examDate ?? right.uploadedAt;
      return Date.parse(rightDate) - Date.parse(leftDate);
    })[0];
}

function createTimedSignal(params: {
  key: CareSignal['key'];
  label: CareSignal['label'];
  referenceDate?: string;
  now: Date;
  dueDays: number;
  watchDays: number;
  missingDetail: string;
  prefix: string;
}): CareSignal {
  const parsed = parseDate(params.referenceDate);
  if (!parsed) {
    return {
      key: params.key,
      label: params.label,
      status: 'due',
      detail: `No ${params.label.toLowerCase()} on record yet`,
    };
  }

  const ageDays = diffDays(parsed, params.now);
  const dueDate = new Date(parsed.getTime() + params.dueDays * dayMs).toISOString().slice(0, 10);

  if (ageDays >= params.dueDays) {
    return {
      key: params.key,
      label: params.label,
      status: 'due',
      detail: `${params.prefix} overdue`,
      dueDate,
    };
  }

  if (ageDays >= params.watchDays) {
    return {
      key: params.key,
      label: params.label,
      status: 'watch',
      detail: `${params.prefix} soon`,
      dueDate,
    };
  }

  return {
    key: params.key,
    label: params.label,
    status: 'clear',
    detail: `${params.prefix} current`,
    dueDate,
  };
}

export function buildTransferGapRows(horses: HorseRecord[], ownershipRecords: OwnershipRecord[], documents: DocumentRecord[]) {
  return horses
    .map((horse) => {
      const record = ownershipRecords.find((item) => item.horseId === horse.id);
      const transferDocs = documents.filter(
        (document) =>
          document.horseId === horse.id &&
          document.state === 'Ready' &&
          (document.type === 'Transfer Packet' || document.type === 'Bill of Sale'),
      );
      const reasons = [...(record?.pendingDocuments ?? [])];

      if (!transferDocs.length) {
        reasons.unshift('Transfer packet missing');
      }

      if (!record) {
        reasons.unshift('Ownership record missing');
      }

      if (record?.transferStatus && record.transferStatus !== 'Clear' && !reasons.includes(record.transferStatus)) {
        reasons.unshift(record.transferStatus);
      }

      if (!reasons.length) {
        return null;
      }

      return {
        horseId: horse.id,
        horseName: horse.name,
        transferStatus: record?.transferStatus ?? 'Attention Required',
        dueDate: record?.complianceDeadline ?? '',
        pendingCount: reasons.length,
        reasons,
      } satisfies TransferGapRow;
    })
    .filter((row): row is TransferGapRow => Boolean(row))
    .sort((left, right) => Date.parse(left.dueDate || '9999-12-31') - Date.parse(right.dueDate || '9999-12-31'));
}

export function buildCareBoardRows(horses: HorseRecord[], documents: DocumentRecord[], receipts: ExpenseReceipt[], now = new Date()) {
  return horses
    .map((horse) => {
      const wormer = latestReceiptForCategory(receipts, horse.id, 'Wormer');
      const dental = latestReceiptForCategory(receipts, horse.id, 'Dental Float');
      const coggins = latestCogginsDocument(documents, horse.id);

      const signals: CareSignal[] = [
        createTimedSignal({
          key: 'wormer',
          label: 'Wormer',
          referenceDate: wormer?.receiptDate,
          now,
          dueDays: 90,
          watchDays: 75,
          missingDetail: 'Wormer missing',
          prefix: 'Wormer',
        }),
        createTimedSignal({
          key: 'dental',
          label: 'Dental Float',
          referenceDate: dental?.receiptDate,
          now,
          dueDays: 365,
          watchDays: 320,
          missingDetail: 'Float missing',
          prefix: 'Dental float',
        }),
        createTimedSignal({
          key: 'coggins',
          label: 'Coggins',
          referenceDate: coggins?.entities.examDate ?? coggins?.uploadedAt,
          now,
          dueDays: 365,
          watchDays: 320,
          missingDetail: 'Coggins missing',
          prefix: 'Coggins',
        }),
      ];

      const priority = signals.reduce((score, signal) => score + (signal.status === 'due' ? 2 : signal.status === 'watch' ? 1 : 0), 0);
      if (!priority) {
        return null;
      }

      return {
        horseId: horse.id,
        horseName: horse.name,
        signals,
        priority,
      } satisfies CareBoardRow;
    })
    .filter((row): row is CareBoardRow => Boolean(row))
    .sort((left, right) => right.priority - left.priority || left.horseName.localeCompare(right.horseName));
}

export function buildBudgetSummary(receipts: ExpenseReceipt[], now = new Date()): BudgetSummary {
  const monthKey = buildMonthKey(now);
  const monthReceipts = receipts
    .filter((receipt) => { const d = parseDate(receipt.receiptDate); return d !== null && buildMonthKey(d) === monthKey; })
    .sort((left, right) => Date.parse(right.receiptDate) - Date.parse(left.receiptDate));

  const categories = monthReceipts.reduce<Map<ExpenseCategory, number>>((totals, receipt) => {
    totals.set(receipt.category, (totals.get(receipt.category) ?? 0) + receipt.amount);
    return totals;
  }, new Map());

  const sortedCategories = Array.from(categories.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount);

  const feed = monthReceipts
    .filter((receipt) => receipt.category === 'Feed' || receipt.category === 'Bedding' || receipt.category === 'Supplements')
    .reduce((sum, receipt) => sum + receipt.amount, 0);
  const health = monthReceipts
    .filter((receipt) => receipt.category === 'Wormer' || receipt.category === 'Dental Float' || receipt.category === 'Vet Care' || receipt.category === 'Farrier')
    .reduce((sum, receipt) => sum + receipt.amount, 0);

  return {
    total: monthReceipts.reduce((sum, receipt) => sum + receipt.amount, 0),
    feed,
    health,
    receiptCount: monthReceipts.length,
    monthKey,
    categories: sortedCategories,
    latestReceipts: monthReceipts.slice(0, 5),
  };
}

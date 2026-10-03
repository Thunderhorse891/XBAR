import type {
  DocumentRecord,
  ExpenseCategory,
  ExpenseReceipt,
  HorseRecord,
  MedicalRecordDetails,
  OwnershipRecord,
  TimelineEvent,
} from '../types/xbar.js';
import { documentExamTime } from './documentCurrency.js';

export type CareSignalStatus = 'due' | 'watch' | 'clear';

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

/*
 * Care is what was done to the horse, on the day it was done (audit F06).
 *
 * The board used to read worming and dental dates from purchase receipts, so
 * buying a wormer marked the horse wormed -- even with a note saying it was
 * never given -- while a deworming logged through Add Health Record changed
 * nothing. It now reads the horse's own medical timeline: the latest Deworming
 * or Dental entry dated today or earlier. A receipt is spending, not care.
 */
const CARE_EVENT: Record<'wormer' | 'dental', { status: string; recordType: MedicalRecordDetails['recordType'] }> = {
  wormer: { status: 'Deworming', recordType: 'deworming' },
  dental: { status: 'Dental', recordType: 'dental' },
};

function latestCompletedCare(horse: HorseRecord, kind: 'wormer' | 'dental', now: Date): TimelineEvent | undefined {
  const match = CARE_EVENT[kind];
  const today = localDayKey(now);
  return (horse.medicalTimeline ?? [])
    .filter((event) => {
      const details = event.details as MedicalRecordDetails | undefined;
      const isKind = event.status === match.status || details?.recordType === match.recordType;
      // A date still ahead is a plan, not care given; one that is not a real
      // calendar day is no date at all.
      const day = careDay(event.date);
      return isKind && day !== null && day <= today;
    })
    .sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0))[0];
}

/*
 * The calendar day a care entry was given, or null when it is not a real day.
 * Restored or synced timelines can carry a well-formed impossible date such as
 * 2026-09-31, which Date would quietly turn into 1 October and score as care.
 * Same refusal documentExamTime makes for a Coggins exam date.
 */
function careDay(value: string | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? match[0] : null;
}

function localDayKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/*
 * The Coggins the board measures from is the one with a readable examination
 * date -- the same reading the sale gates use (documentCurrency.ts). A
 * certificate with no exam date is not current from the day it was uploaded:
 * the upload date says when the paper reached XBAR, not when the horse was
 * tested, and the canonical helper already refused it.
 */
function latestCogginsExam(documents: DocumentRecord[], horseId: string, now: Date) {
  const today = localDayKey(now);
  const ready = documents.filter(
    (document) => document.horseId === horseId && document.type === 'Coggins' && document.state === 'Ready',
  );
  const dated = ready
    .map((document) => {
      const examTime = documentExamTime(document);
      return { examDay: examTime === null ? null : new Date(examTime).toISOString().slice(0, 10) };
    })
    // An exam cannot have happened yet: a mistyped future year is no exam, the
    // same refusal the canonical currency helper makes.
    .filter((entry): entry is { examDay: string } => entry.examDay !== null && entry.examDay <= today)
    .sort((left, right) => (left.examDay < right.examDay ? 1 : -1))[0];
  return { examDate: dated?.examDay, undatedOnFile: !dated && ready.length > 0 };
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

export function buildTransferGapRows(
  horses: HorseRecord[],
  ownershipRecords: OwnershipRecord[],
  documents: DocumentRecord[],
) {
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

export function buildCareBoardRows(
  horses: HorseRecord[],
  documents: DocumentRecord[],
  // Kept for its callers; no longer read. A purchase is not care (audit F06).
  _receipts: ExpenseReceipt[],
  now = new Date(),
) {
  return horses
    .map((horse) => {
      const wormer = latestCompletedCare(horse, 'wormer', now);
      const dental = latestCompletedCare(horse, 'dental', now);
      const coggins = latestCogginsExam(documents, horse.id, now);

      const signals: CareSignal[] = [
        createTimedSignal({
          key: 'wormer',
          label: 'Wormer',
          referenceDate: wormer?.date,
          now,
          dueDays: 90,
          watchDays: 75,
          missingDetail: 'Wormer missing',
          prefix: 'Wormer',
        }),
        createTimedSignal({
          key: 'dental',
          label: 'Dental Float',
          referenceDate: dental?.date,
          now,
          dueDays: 365,
          watchDays: 320,
          missingDetail: 'Float missing',
          prefix: 'Dental float',
        }),
        createTimedSignal({
          key: 'coggins',
          label: 'Coggins',
          referenceDate: coggins.examDate,
          now,
          dueDays: 365,
          watchDays: 320,
          missingDetail: 'Coggins missing',
          prefix: 'Coggins',
        }),
      ];

      // Say why a Coggins on file does not count, rather than that none exists.
      if (coggins.undatedOnFile) {
        const signal = signals.find((item) => item.key === 'coggins');
        if (signal && signal.status === 'due') signal.detail = 'Coggins on file has no valid exam date';
      }

      const priority = signals.reduce(
        (score, signal) => score + (signal.status === 'due' ? 2 : signal.status === 'watch' ? 1 : 0),
        0,
      );
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
    .filter((receipt) => {
      const d = parseDate(receipt.receiptDate);
      return d !== null && buildMonthKey(d) === monthKey;
    })
    .sort((left, right) => Date.parse(right.receiptDate) - Date.parse(left.receiptDate));

  const categories = monthReceipts.reduce<Map<ExpenseCategory, number>>((totals, receipt) => {
    totals.set(receipt.category, (totals.get(receipt.category) ?? 0) + receipt.amount);
    return totals;
  }, new Map());

  const sortedCategories = Array.from(categories.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount);

  const feed = monthReceipts
    .filter(
      (receipt) => receipt.category === 'Feed' || receipt.category === 'Bedding' || receipt.category === 'Supplements',
    )
    .reduce((sum, receipt) => sum + receipt.amount, 0);
  const health = monthReceipts
    .filter(
      (receipt) =>
        receipt.category === 'Wormer' ||
        receipt.category === 'Dental Float' ||
        receipt.category === 'Vet Care' ||
        receipt.category === 'Farrier',
    )
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

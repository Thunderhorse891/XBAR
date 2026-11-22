import type { DocumentRecord, HorseRecord, MedicalRecordDetails } from '../types/xbar.js';
import { documentExamTime } from './documentCurrency.js';
import { careDay } from './medicalEvidence.js';

const dayMs = 86_400_000;
const treatments = {
  wormer: { status: 'Deworming', recordType: 'deworming' },
  dental: { status: 'Dental', recordType: 'dental' },
} as const satisfies Record<string, { status: string; recordType: MedicalRecordDetails['recordType'] }>;
const intervals = {
  wormer: [90, 75],
  dental: [365, 320],
  coggins: [365, 320],
} as const;

export type CareKind = keyof typeof intervals;
export type CareProjection =
  | { kind: CareKind; status: 'missing'; invalidExamOnFile?: true }
  | { kind: CareKind; status: 'due' | 'watch' | 'clear'; evidenceDay: string; dueDay: string; evidenceIds: string[] };

type Evidence = { day: string; id: string };

function latestOnDay(rows: Evidence[], today: string) {
  let day = '';
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.day > today || row.day < day) continue;
    if (row.day > day) {
      ids.clear();
      day = row.day;
    }
    ids.add(row.id);
  }
  return day ? { day, ids: [...ids].sort() } : undefined;
}

/**
 * Derive care dates from records, not purchases, and don't prescribe work for
 * an undated record. The caller supplies the evaluation day (browser-local on
 * the existing board; a future scheduler must resolve the workspace calendar).
 * Projection is not consent to notify, delivery state, or a durable revision.
 */
export function projectCareEvidence(
  horse: Pick<HorseRecord, 'id' | 'medicalTimeline'>,
  documents: readonly DocumentRecord[],
  today: string,
): CareProjection[] {
  if (careDay(today) !== today) throw new RangeError('Care projection requires a valid calendar day');
  const todayMs = Date.parse(`${today}T00:00:00Z`);

  const project = (kind: CareKind, rows: Evidence[], hasExamOnFile = false): CareProjection => {
    const latest = latestOnDay(rows, today);
    if (!latest) return { kind, status: 'missing', ...(hasExamOnFile ? { invalidExamOnFile: true } : {}) };
    const [due, watch] = intervals[kind];
    const start = Date.parse(`${latest.day}T00:00:00Z`);
    const age = (todayMs - start) / dayMs;
    const overdue = kind === 'coggins' ? age > due : age >= due;
    return {
      kind,
      status: overdue ? 'due' : age >= watch ? 'watch' : 'clear',
      evidenceDay: latest.day,
      dueDay: new Date(start + due * dayMs).toISOString().slice(0, 10),
      evidenceIds: latest.ids,
    };
  };

  const treatmentsFor = (kind: keyof typeof treatments) => {
    const match = treatments[kind];
    const evidence: Evidence[] = [];
    for (const event of horse.medicalTimeline ?? []) {
      const details = event.details as MedicalRecordDetails | undefined;
      if (
        event.completionState !== 'completed' ||
        (event.status !== match.status && details?.recordType !== match.recordType)
      )
        continue;
      const day = careDay(event.date);
      if (day) evidence.push({ day, id: event.id });
    }
    return evidence;
  };

  const exams: Evidence[] = [];
  let hasExamOnFile = false;
  for (const doc of documents) {
    if (doc.horseId !== horse.id || doc.type !== 'Coggins' || doc.state !== 'Ready') continue;
    hasExamOnFile = true;
    const exam = documentExamTime(doc);
    if (exam !== null) exams.push({ day: new Date(exam).toISOString().slice(0, 10), id: doc.id });
  }

  return [
    project('wormer', treatmentsFor('wormer')),
    project('dental', treatmentsFor('dental')),
    project('coggins', exams, hasExamOnFile),
  ];
}

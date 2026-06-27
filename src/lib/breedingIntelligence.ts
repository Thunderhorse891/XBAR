import type { HorseRecord, TimelineEvent, BreedingRecordDetails } from '../types/xbar.js';

/*
 * Breeding operations intelligence. Pure domain logic over the breeding
 * timeline and economics already on each mare — no I/O, fully testable.
 *
 * Equine reproduction constants are real: mean gestation is ~340 days
 * (normal 320-362), pregnancy diagnostics follow a standard ultrasound
 * cadence, and EHV-1 (rhinopneumonitis) boosters plus pre-foaling vaccines
 * are compliance-critical. Every derived item carries its own next action so
 * a number never leaves this module without a way to act on it.
 */

export const GESTATION_MEAN_DAYS = 340;
export const GESTATION_EARLY_DAYS = 320; // viable early window opens
export const GESTATION_LATE_DAYS = 362; // beyond this is overdue / vet review
const NEAR_TERM_WINDOW_DAYS = 30;
// A missed checkpoint is only actionable while it is recently missed; one
// that lapsed months ago is presumed handled (or moot) and is not nagged.
const RECENT_OVERDUE_WINDOW_DAYS = 21;
const DAY_MS = 86_400_000;

export type MareStatus =
  | 'open'
  | 'bred-awaiting-check'
  | 'in-foal'
  | 'near-term'
  | 'foaled-live'
  | 'foaled-loss'
  | 'not-breeding';

export type GuaranteeState = 'none' | 'covered' | 'fulfilled' | 'rebreed-owed';

export interface BreedingCheckpoint {
  id: string;
  label: string;
  dueDate: string; // ISO date
  dayOffset: number;
  kind: 'diagnostic' | 'vaccination' | 'foaling-prep';
  critical: boolean;
  status: 'upcoming' | 'due' | 'overdue';
}

export interface MareBreedingState {
  horseId: string;
  horseName: string;
  status: MareStatus;
  statusLabel: string;
  mateName?: string;
  method?: BreedingRecordDetails['method'];
  bredOn?: string;
  expectedFoalingDate?: string;
  foalingWindowStart?: string;
  foalingWindowEnd?: string;
  daysToFoaling?: number;
  guarantee: GuaranteeState;
  nextCheckpoint?: BreedingCheckpoint;
  overdueCheckpoints: BreedingCheckpoint[];
  projectedFoalValue: number;
  projectedFoalMargin: number;
  actionLabel: string;
  actionRoute: string;
}

export interface BreedingProgram {
  maresTracked: number;
  inFoal: number;
  nearTerm: number;
  foalingsDueSoon: number; // within near-term window
  overdueCheckCount: number;
  projectedProgramValue: number;
  projectedProgramMargin: number;
  mares: MareBreedingState[];
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function breedingDetails(event: TimelineEvent): BreedingRecordDetails | undefined {
  const details = event.details as BreedingRecordDetails | undefined;
  return details && 'recordType' in details ? details : undefined;
}

// Events logged through the in-app "Add breeding event" flow carry no
// structured details payload — only a free-text title/summary. Infer the
// record type from that text so user-entered milestones are first-class
// alongside OCR/structured records. Order matters: pregnancy-check phrases
// (e.g. "in foal") are tested before foaling so they are not misread as a
// birth.
function resolveRecordType(event: TimelineEvent): BreedingRecordDetails['recordType'] | undefined {
  const explicit = breedingDetails(event)?.recordType;
  if (explicit) return explicit;
  if (event.category !== 'Breeding') return undefined;
  const text = `${event.title} ${event.summary}`.toLowerCase();

  // A birth event wins outright ("in foal" is deliberately NOT a birth).
  if (/foaled|foaling|parturition|delivered|gave birth|\bborn\b|stillborn|abort/.test(text)) return 'foaling';

  // A breeding verb/noun (word-bounded to avoid "recovered"/"observed") marks
  // a cover. It outranks result words like "open"/"in foal", which often just
  // describe the mare's prior state in the same note ("open mare bred to
  // Thunder"). An explicit scan/check term flips it back to a pregnancy check.
  const hasBreedingVerb = /\bbred\b|\bbreed\b|\bcover\b|\bserved\b|insemin|\bai\b|\bmated\b|\bbooked\b|\bstud\b/.test(text);
  const hasCheckTerm = /ultrasound|sonogram|preg(?:nancy)?.?check|vet.?check|\bscan\b|heartbeat|\bchecked\b/.test(text);
  if (hasBreedingVerb && !hasCheckTerm) return 'breeding';

  if (hasCheckTerm || /in.?foal|\bopen\b|barren|confirm|pregnant|positive|negative/.test(text)) return 'pregnancy-check';
  if (hasBreedingVerb) return 'breeding';
  return undefined;
}

// All the text we can match an outcome against: the structured result, the
// event status, and the free-text title/summary of an in-app entry.
function outcomeText(event: TimelineEvent): string {
  const details = breedingDetails(event);
  return `${details?.result ?? ''} ${event.status ?? ''} ${event.title} ${event.summary}`.toLowerCase();
}

// Standard equine prenatal cadence (days after cover/insemination). EHV-1
// boosters and pre-foaling vaccines are flagged compliance-critical.
const CHECKPOINT_TEMPLATE: { day: number; label: string; kind: BreedingCheckpoint['kind']; critical: boolean }[] = [
  { day: 15, label: 'Early pregnancy + twin ultrasound', kind: 'diagnostic', critical: true },
  { day: 28, label: 'Heartbeat confirmation', kind: 'diagnostic', critical: true },
  { day: 45, label: 'Viability recheck', kind: 'diagnostic', critical: false },
  { day: 60, label: 'Fetal sexing (optional)', kind: 'diagnostic', critical: false },
  { day: 150, label: 'EHV-1 booster (5-month)', kind: 'vaccination', critical: true },
  { day: 210, label: 'EHV-1 booster (7-month)', kind: 'vaccination', critical: true },
  { day: 270, label: 'EHV-1 booster (9-month)', kind: 'vaccination', critical: true },
  { day: 310, label: 'Pre-foaling vaccines + foaling kit', kind: 'foaling-prep', critical: true },
];

export function buildCheckpoints(bredOn: Date, now: Date): BreedingCheckpoint[] {
  return CHECKPOINT_TEMPLATE.map((template) => {
    const dueDate = addDays(bredOn, template.day);
    const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / DAY_MS);
    const status: BreedingCheckpoint['status'] = daysUntil < 0 ? 'overdue' : daysUntil <= 7 ? 'due' : 'upcoming';
    return {
      id: `chk-${template.day}`,
      label: template.label,
      dueDate: isoDate(dueDate),
      dayOffset: template.day,
      kind: template.kind,
      critical: template.critical,
      status,
    };
  });
}

function latestByRecordType(events: TimelineEvent[], recordType: BreedingRecordDetails['recordType']): TimelineEvent | undefined {
  return events
    .filter((event) => resolveRecordType(event) === recordType)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
}

function positivePregnancyCheck(events: TimelineEvent[], afterISO: string): boolean {
  return events.some((event) => {
    if (resolveRecordType(event) !== 'pregnancy-check' || event.date < afterISO) return false;
    const result = outcomeText(event);
    // A check is only positive if it is not also an explicit open/negative.
    if (/\bopen\b|negative|not.?in.?foal|barren|empty/.test(result)) return false;
    return /in.?foal|positive|confirmed|pregnant|heartbeat/.test(result);
  });
}

function negativePregnancyCheck(events: TimelineEvent[], afterISO: string): boolean {
  return events.some((event) => {
    if (resolveRecordType(event) !== 'pregnancy-check' || event.date < afterISO) return false;
    const result = outcomeText(event);
    return /\bopen\b|negative|not.?in.?foal|barren|empty/.test(result);
  });
}

// Live-foal-guarantee: a confirmed cover is "covered"; a recorded live
// foaling fulfils it; a loss leaves a rebreed owed to the mare owner.
function guaranteeFor(status: MareStatus): GuaranteeState {
  switch (status) {
    case 'foaled-live':
      return 'fulfilled';
    case 'foaled-loss':
      return 'rebreed-owed';
    case 'in-foal':
    case 'near-term':
    case 'bred-awaiting-check':
      return 'covered';
    default:
      return 'none';
  }
}

const STATUS_LABELS: Record<MareStatus, string> = {
  open: 'Open — ready to breed',
  'bred-awaiting-check': 'Bred — awaiting confirmation',
  'in-foal': 'Confirmed in foal',
  'near-term': 'Near term',
  'foaled-live': 'Foaled — live',
  'foaled-loss': 'Foaling loss',
  'not-breeding': 'Not in breeding program',
};

export function buildMareBreedingState(horse: HorseRecord, now: Date = new Date()): MareBreedingState {
  const events = horse.breedingTimeline ?? [];
  const breeding = latestByRecordType(events, 'breeding');
  const breedingDetail = breeding ? breedingDetails(breeding) : undefined;
  const bredOn = toDate(breeding?.date);

  const economics = horse.breedingEconomics;
  const projectedFoalValue = economics?.foalProjectedValue ?? 0;
  // Per-foal margin: projected value less the breeding cost share (stud fee
  // is embedded in breedingCosts when present).
  const projectedFoalMargin = projectedFoalValue - (economics?.breedingCosts ?? 0);

  const base = {
    horseId: horse.id,
    horseName: horse.name,
    mateName: breedingDetail?.mateName,
    method: breedingDetail?.method,
    bredOn: breeding?.date,
    projectedFoalValue,
    projectedFoalMargin,
    overdueCheckpoints: [] as BreedingCheckpoint[],
  };

  // Mares only (geldings/stallions are not carriers). Stallions with stud
  // bookings are surfaced at the program level, not as carriers here.
  if (horse.sex !== 'Mare' && horse.sex !== 'Filly') {
    return {
      ...base,
      status: 'not-breeding',
      statusLabel: STATUS_LABELS['not-breeding'],
      guarantee: 'none',
      actionLabel: '',
      actionRoute: '/breeding',
    };
  }

  if (!breeding || !bredOn) {
    return {
      ...base,
      status: 'open',
      statusLabel: STATUS_LABELS.open,
      guarantee: 'none',
      actionLabel: `Log a breeding for ${horse.name}`,
      actionRoute: '/breeding',
    };
  }

  const foaling = latestByRecordType(events, 'foaling');
  if (foaling && foaling.date >= breeding.date) {
    const result = outcomeText(foaling);
    // Loss-specific terms only — a bare "still" (e.g. "mare and foal still
    // doing well") must not flip a live foaling to a loss.
    const live = !/\bloss\b|stillborn|still.?birth|\bdead\b|\bdied\b|abort|slipped/.test(result);
    const status: MareStatus = live ? 'foaled-live' : 'foaled-loss';
    return {
      ...base,
      status,
      statusLabel: STATUS_LABELS[status],
      guarantee: guaranteeFor(status),
      actionLabel: live ? `Register the foal for ${horse.name}` : `Schedule rebreed for ${horse.name}`,
      actionRoute: '/breeding',
    };
  }

  // Open again if a check came back negative.
  if (negativePregnancyCheck(events, breeding.date)) {
    return {
      ...base,
      status: 'open',
      statusLabel: STATUS_LABELS.open,
      guarantee: 'none',
      actionLabel: `Rebreed ${horse.name} this cycle`,
      actionRoute: '/breeding',
    };
  }

  const checkpoints = buildCheckpoints(bredOn, now);
  const overdueCheckpoints = checkpoints.filter((checkpoint) => {
    if (checkpoint.status !== 'overdue' || !checkpoint.critical) return false;
    const ageDays = (now.getTime() - new Date(checkpoint.dueDate).getTime()) / DAY_MS;
    return ageDays <= RECENT_OVERDUE_WINDOW_DAYS;
  });
  const nextCheckpoint = checkpoints.find((checkpoint) => checkpoint.status !== 'overdue');

  const expectedFoaling = addDays(bredOn, GESTATION_MEAN_DAYS);
  const windowStart = addDays(bredOn, GESTATION_EARLY_DAYS);
  const windowEnd = addDays(bredOn, GESTATION_LATE_DAYS);
  const daysToFoaling = Math.ceil((expectedFoaling.getTime() - now.getTime()) / DAY_MS);

  const confirmed = positivePregnancyCheck(events, breeding.date);

  // Once "now" is past the latest viable foaling date (GESTATION_LATE_DAYS)
  // with no foaling or negative check recorded, the record is stale: the mare
  // has almost certainly foaled or slipped and the outcome was never logged.
  // daysToFoaling is measured from the mean date, so the late window sits at
  // (mean - late) days. Past that, do not count her as an active pregnancy or
  // hand her a foaling-kit action months late — surface her for resolution.
  const isOverdueFoaling = daysToFoaling < GESTATION_MEAN_DAYS - GESTATION_LATE_DAYS;

  // A mare counts as "in foal" only with a positive check, or once she is
  // visibly near term. Bred-but-unconfirmed stays "awaiting check" — the
  // overdue diagnostics surface the gap instead of overstating the program.
  let status: MareStatus;
  if (isOverdueFoaling) {
    status = 'bred-awaiting-check';
  } else if (daysToFoaling <= NEAR_TERM_WINDOW_DAYS) {
    status = 'near-term';
  } else if (confirmed) {
    status = 'in-foal';
  } else {
    status = 'bred-awaiting-check';
  }

  // Action priority: inside the foaling window, foaling prep is the dominant
  // concern; otherwise a recently-missed critical checkpoint leads, then
  // confirmation, then the routine next checkpoint.
  let actionLabel: string;
  if (isOverdueFoaling) {
    actionLabel = `Record foaling outcome for ${horse.name} (past due ${isoDate(expectedFoaling)})`;
  } else if (status === 'near-term') {
    actionLabel = `Prepare foaling kit for ${horse.name} (due ${isoDate(expectedFoaling)})`;
  } else if (overdueCheckpoints.length) {
    actionLabel = `${horse.name}: ${overdueCheckpoints[0]!.label} overdue`;
  } else if (status === 'bred-awaiting-check') {
    actionLabel = `Confirm pregnancy for ${horse.name}`;
  } else if (nextCheckpoint) {
    actionLabel = `${horse.name}: ${nextCheckpoint.label} on ${nextCheckpoint.dueDate}`;
  } else {
    actionLabel = `Review ${horse.name} foaling plan`;
  }

  return {
    ...base,
    status,
    statusLabel: STATUS_LABELS[status],
    expectedFoalingDate: isoDate(expectedFoaling),
    foalingWindowStart: isoDate(windowStart),
    foalingWindowEnd: isoDate(windowEnd),
    daysToFoaling,
    guarantee: guaranteeFor(status),
    nextCheckpoint,
    overdueCheckpoints,
    actionLabel,
    actionRoute: '/breeding',
  };
}

export function buildBreedingProgram(horses: HorseRecord[], now: Date = new Date()): BreedingProgram {
  const carriers = horses
    .map((horse) => buildMareBreedingState(horse, now))
    .filter((state) => state.status !== 'not-breeding')
    // Only mares that have entered the program (bred at least once) or are
    // flagged open with breeding economics attached.
    .filter((state) => state.status !== 'open' || Boolean(state.projectedFoalValue));

  const inFoalStates = carriers.filter((state) => state.status === 'in-foal' || state.status === 'near-term');
  const nearTerm = carriers.filter((state) => state.status === 'near-term');
  const overdueCheckCount = carriers.reduce((sum, state) => sum + state.overdueCheckpoints.length, 0);

  // Program value = projected foal value across all carrying mares; margin
  // nets the breeding costs already captured per mare.
  const projectedProgramValue = inFoalStates.reduce((sum, state) => sum + state.projectedFoalValue, 0);
  const projectedProgramMargin = inFoalStates.reduce((sum, state) => sum + state.projectedFoalMargin, 0);

  // Sort by urgency: overdue checks first, then nearest foaling.
  carriers.sort((a, b) => {
    if (b.overdueCheckpoints.length !== a.overdueCheckpoints.length) {
      return b.overdueCheckpoints.length - a.overdueCheckpoints.length;
    }
    return (a.daysToFoaling ?? Infinity) - (b.daysToFoaling ?? Infinity);
  });

  return {
    maresTracked: carriers.length,
    inFoal: inFoalStates.length,
    nearTerm: nearTerm.length,
    foalingsDueSoon: nearTerm.length,
    overdueCheckCount,
    projectedProgramValue,
    projectedProgramMargin,
    mares: carriers,
  };
}

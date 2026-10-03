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
  'open' | 'bred-awaiting-check' | 'in-foal' | 'near-term' | 'foaled-live' | 'foaled-loss' | 'not-breeding';

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
  const hasBreedingVerb = /\bbred\b|\bbreed\b|\bcover\b|\bserved\b|insemin|\bai\b|\bmated\b|\bbooked\b|\bstud\b/.test(
    text,
  );
  const hasCheckTerm = /ultrasound|sonogram|preg(?:nancy)?.?check|vet.?check|\bscan\b|heartbeat|\bchecked\b/.test(text);
  if (hasBreedingVerb && !hasCheckTerm) return 'breeding';

  if (hasCheckTerm || /in.?foal|\bopen\b|barren|confirm|pregnant|positive|negative/.test(text))
    return 'pregnancy-check';
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

function latestByRecordType(
  events: TimelineEvent[],
  recordType: BreedingRecordDetails['recordType'],
): TimelineEvent | undefined {
  return events
    .filter((event) => resolveRecordType(event) === recordType)
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))[0];
}

// A date-only boundary must also respect newest-first insertion order. Earlier
// same-day evidence belongs to the previous cycle, for both covers and foalings.
function eventsAfter(events: TimelineEvent[], boundary: TimelineEvent): TimelineEvent[] {
  const boundaryOrder = events.indexOf(boundary);
  return events.filter(
    (event, order) => event.date > boundary.date || (event.date === boundary.date && order < boundaryOrder),
  );
}

/*
 * What one pregnancy check says (audit F07).
 *
 * A check logged through the form carries its result as a choice -- 'in-foal',
 * 'open' or 'pending' -- and that choice is the answer; the note beside it is
 * context. Everything else (older free-text entries, OCR records) is read the
 * way a person would read it, and anything a person would call unclear stays
 * unknown rather than being guessed:
 *
 *   - a positive word that is negated in its own clause does not count:
 *     "no heartbeat", "not yet confirmed", "mare is not pregnant";
 *   - "confirmed" asserts whatever follows it in its clause: "confirmed open"
 *     and "confirmed not pregnant" are open; bare "confirmed" is in foal;
 *   - "negative for twins" is not a negative;
 *   - positive and negative wording in the same entry is unknown.
 *
 * Text matching used to read "Pregnancy check -- Negative, mare is not
 * pregnant" as in foal, because "pregnant" matched before anything looked at
 * the "not" in front of it.
 */
export type PregnancyCheckOutcome = 'positive' | 'negative' | 'unknown';

const NEGATIVE_WORDING =
  /\bopen\b|\bnegative\b(?!\s+for\s+twins?)|not.?in.?foal|not.?pregnant|\bbarren\b|\bempty\b|\bslipped\b|\blost\b|\bresorb/;
const POSITIVE_WORDING =
  /in.?foal|\bpositive\b|\bconfirmed\b|\bpregnant\b|heartbeat|\bsingle(?:ton)?\s+(?:pregnancy|embryo|vesicle)/g;
const CLAUSE_NEGATION = /\b(?:no|not|without|never|isn'?t|wasn'?t|yet to be)\b/;
// Free-text questions and uncertainty cannot establish a pregnancy outcome.
const UNCERTAIN_WORDING =
  /\?|\b(?:possibly|possible|maybe|uncertain|unclear|unconfirmed|inconclusive|equivocal|suspected|suspect|cannot|can't|could not|unable to|indeterminate)\b/;
const CLAUSE_BREAK = /[.;,:!?\n\u2013\u2014]|\s-\s/;

export function pregnancyCheckOutcome(event: TimelineEvent): PregnancyCheckOutcome {
  // Restored backups can carry any JSON here; only a string is a result.
  const rawResult: unknown = breedingDetails(event)?.result;
  const structured = typeof rawResult === 'string' ? rawResult.trim().toLowerCase() : '';
  if (structured === 'in-foal') return 'positive';
  if (structured === 'open') return 'negative';
  if (structured === 'pending') return 'unknown';

  // An OCR or imported result is still the most specific text there is.
  const text = (structured || `${event.status ?? ''} ${event.title} ${event.summary}`).toLowerCase();
  if (UNCERTAIN_WORDING.test(text)) return 'unknown';
  const negative = NEGATIVE_WORDING.test(text);
  let positive = false;
  for (const match of text.matchAll(POSITIVE_WORDING)) {
    const before = text.slice(0, match.index).split(CLAUSE_BREAK).pop() ?? '';
    const after = text.slice((match.index ?? 0) + match[0].length).split(CLAUSE_BREAK)[0] ?? '';
    if (CLAUSE_NEGATION.test(before) || CLAUSE_NEGATION.test(after)) continue;
    // "Confirmed" is not a result on its own; it confirms what follows it. Only
    // with nothing negating or negative after it in its clause is it in foal.
    if (match[0] === 'confirmed') {
      if (NEGATIVE_WORDING.test(after)) continue;
    }
    positive = true;
  }
  if (negative && positive) return 'unknown';
  if (negative) return 'negative';
  if (positive) return 'positive';
  return 'unknown';
}

/*
 * Where the mare stands after a cover: the latest non-pending check. A later re-check overrides an earlier one -- open at 14 days and in
 * foal at 16 is in foal; in foal at 16 and open at 45 is a loss -- and a check
 * explicitly marked pending does not erase the prior result. An ambiguous or
 * unreadable check stops classification; it is not evidence of a prior result.
 * Same-day checks resolve to the one entered last (the timeline is newest-first).
 */
export function currentPregnancyOutcome(events: TimelineEvent[], afterISO: string): PregnancyCheckOutcome {
  const checks = events
    .map((event, order) => ({ event, order }))
    .filter(({ event }) => resolveRecordType(event) === 'pregnancy-check' && event.date >= afterISO)
    .sort((a, b) => (a.event.date === b.event.date ? a.order - b.order : a.event.date < b.event.date ? 1 : -1));
  for (const { event } of checks) {
    const result: unknown = breedingDetails(event)?.result;
    if (typeof result === 'string' && result.trim().toLowerCase() === 'pending') continue;
    return pregnancyCheckOutcome(event);
  }
  return 'unknown';
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

  const foaling = latestByRecordType(events, 'foaling');
  // Day-only dates need the timeline's newest-first order to separate cycles.
  const completedCycle =
    foaling &&
    (!breeding ||
      foaling.date > breeding.date ||
      (foaling.date === breeding.date && events.indexOf(foaling) < events.indexOf(breeding)));

  if (!breeding || !bredOn || completedCycle) {
    // A mare can arrive already in foal: a positive check with no cover on file
    // is in foal, not open. Her due date is unknown and is never invented from
    // the check, so she has no foaling window until the cover is logged. Checks
    // from before her latest foaling belong to an earlier pregnancy.
    const currentEvents = foaling ? eventsAfter(events, foaling) : events;
    if (currentPregnancyOutcome(currentEvents, '') === 'positive') {
      return {
        ...base,
        status: 'in-foal',
        statusLabel: STATUS_LABELS['in-foal'],
        // A completed cover cannot provide dates or a sire for this pregnancy.
        bredOn: undefined,
        mateName: undefined,
        method: undefined,
        guarantee: 'none',
        actionLabel: `Log the cover date for ${horse.name} to track her foaling window`,
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
  }

  if (foaling && completedCycle) {
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

  // Open again if the latest definite check came back negative.
  const currentCycleEvents = eventsAfter(events, breeding);
  const pregnancy = currentPregnancyOutcome(currentCycleEvents, breeding.date);
  if (pregnancy === 'negative') {
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
  // Gestational day of the latest logged pregnancy check (−1 if none). A check
  // satisfies every earlier diagnostic checkpoint — a day-20 scan covers the
  // day-15 ultrasound — so those should not be surfaced as overdue.
  const latestCheckDay = currentCycleEvents.reduce((latest, event) => {
    if (resolveRecordType(event) !== 'pregnancy-check') return latest;
    const day = Math.floor((new Date(event.date).getTime() - bredOn.getTime()) / DAY_MS);
    return day >= 0 ? Math.max(latest, day) : latest;
  }, -1);
  const overdueCheckpoints = checkpoints.filter((checkpoint) => {
    if (checkpoint.status !== 'overdue' || !checkpoint.critical) return false;
    // A logged check supersedes diagnostic checkpoints at or before its day.
    if (checkpoint.kind === 'diagnostic' && checkpoint.dayOffset <= latestCheckDay) return false;
    const ageDays = (now.getTime() - new Date(checkpoint.dueDate).getTime()) / DAY_MS;
    return ageDays <= RECENT_OVERDUE_WINDOW_DAYS;
  });
  const nextCheckpoint = checkpoints.find((checkpoint) => checkpoint.status !== 'overdue');

  const expectedFoaling = addDays(bredOn, GESTATION_MEAN_DAYS);
  const windowStart = addDays(bredOn, GESTATION_EARLY_DAYS);
  const windowEnd = addDays(bredOn, GESTATION_LATE_DAYS);
  const daysToFoaling = Math.ceil((expectedFoaling.getTime() - now.getTime()) / DAY_MS);

  const confirmed = pregnancy === 'positive';

  // Once "now" is past the latest viable foaling date (GESTATION_LATE_DAYS)
  // with no foaling or negative check recorded, the record is stale: the mare
  // has almost certainly foaled or slipped and the outcome was never logged.
  // daysToFoaling is measured from the mean date, so the late window sits at
  // (mean - late) days. Past that, do not count her as an active pregnancy or
  // hand her a foaling-kit action months late — surface her for resolution.
  const isOverdueFoaling = daysToFoaling < GESTATION_MEAN_DAYS - GESTATION_LATE_DAYS;

  // A mare counts as "in foal" -- and so as near term -- only with a positive
  // check. Elapsed time since a cover is not a pregnancy: an unconfirmed cover
  // 320 days ago is as likely to have slipped or never taken, so it stays
  // "awaiting check" and is left out of the in-foal count and program value.
  let status: MareStatus;
  if (isOverdueFoaling) {
    status = 'bred-awaiting-check';
  } else if (confirmed && daysToFoaling <= NEAR_TERM_WINDOW_DAYS) {
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
  } else if (daysToFoaling <= NEAR_TERM_WINDOW_DAYS) {
    // Unconfirmed, but foaling would be close if she took: confirming is urgent.
    actionLabel = `Confirm pregnancy for ${horse.name} (foaling would be due ${isoDate(expectedFoaling)})`;
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
    // Keep any mare that has entered the program: a recorded breeding
    // (bredOn) means she belongs here even if she came back open — her
    // "rebreed this cycle" action must stay visible. Open mares with no
    // breeding history are only included once economics are attached.
    .filter((state) => state.status !== 'open' || Boolean(state.bredOn) || Boolean(state.projectedFoalValue));

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

import type { HorseRecord, TimelineEvent, BreedingRecordDetails } from '../types/xbar.js';
import { localIsoDate } from './format.js';
import { breedingDate as toDate, breedingInstant } from './breedingEntry.js';

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
  | 'foaling-unknown'
  | 'pregnancy-unknown'
  | 'not-breeding';

export type GuaranteeState =
  'not-recorded' | 'unconfirmed' | 'conditions-pending' | 'excluded' | 'expired' | 'recorded' | 'claim-review';

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
  guaranteeLabel: string;
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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function breedingDetails(event: TimelineEvent): BreedingRecordDetails | undefined {
  const details = event.details;
  return details && typeof details === 'object' && 'recordType' in details
    ? (details as BreedingRecordDetails)
    : undefined;
}

/** Legacy records remain readable; explicit plans/cancellations never become evidence. */
function isOccurredBreedingEvent(event: TimelineEvent): boolean {
  if (event.completionState !== undefined) return event.completionState === 'completed';
  const status = `${event.status ?? ''}`.toLowerCase();
  if (/\b(?:planned|scheduled|cancelled|canceled|pending|booked)\b/.test(status)) return false;
  const title = `${event.title ?? ''}`.toLowerCase();
  const eventTitleClause = title.split(OUTCOME_CLAUSE_BREAK)[0] ?? '';
  // Explicit occurrence/cancellation controls outrank outcomes. Otherwise a
  // chosen legacy outcome outranks contextual due dates and follow-up plans.
  if (/\b(?:cancelled|canceled)\b|\b(?:procedure|scan|check|ultrasound)\s+(?:was\s+)?aborted\b/.test(eventTitleClause))
    return false;
  const result = breedingDetails(event)?.result;
  if (typeof result === 'string' && /^(?:in-foal|open|pending|live|loss|unknown)$/.test(result.trim().toLowerCase()))
    return true;
  if (isAdministrativeOnlyBreedingNote(event)) return false;
  const planning =
    /\b(?:cancelled|canceled|scheduled|planned|planning|booking|booked|expecting|expected|due|prepare|preparation|prep)\b|\b(?:buy|purchase|order)\b.*\bfoaling kit\b/;
  if (
    planning.test(eventTitleClause) ||
    /\b(?:will|to be|going to)\s+(?:be\s+)?(?:bred|covered|served|inseminated|mated|foaled)\b/.test(eventTitleClause)
  )
    return false;
  if (/\b(?:foaled|bred|covered|inseminated|mated)\b|\bgave birth\b/.test(eventTitleClause)) return true;
  if (pregnancyCheckOutcome({ ...event, summary: '', status: undefined, details: undefined }) !== 'unknown')
    return true;
  const firstClause = `${event.summary ?? ''}`.toLowerCase().split(/[.;\n]/)[0] ?? '';
  return !planning.test(firstClause);
}

// Events logged through the in-app "Add breeding event" flow carry no
// structured details payload — only a free-text title/summary. Infer the
// record type from that text so user-entered milestones are first-class
// alongside OCR/structured records. Order matters: pregnancy-check phrases
// (e.g. "in foal") are tested before foaling so they are not misread as a
// birth.
function resolveRecordType(event: TimelineEvent): BreedingRecordDetails['recordType'] | undefined {
  if (event.category !== 'Breeding' || !isOccurredBreedingEvent(event)) return undefined;
  const explicit = breedingDetails(event)?.recordType;
  if (explicit) return explicit;
  const text = `${event.title}. ${event.summary}`.toLowerCase();

  // A birth event wins outright ("in foal" is deliberately NOT a birth).
  const birthWording =
    /\bfoaled\b|\bgave birth\b|\b(?:foal|colt|filly)\s+(?:was\s+)?(?:born|delivered)\b|\b(?:delivered|delivery of)\s+(?:(?:a|the|live|healthy|dead|stillborn)\s+)*(?:foal|colt|filly)\b|\bstillborn\b|\b(?:mare|pregnancy|foal|fetus|foetus)\s+(?:was\s+)?aborted\b|\baborted\s+(?:pregnancy|foal|fetus|foetus)\b/;
  const birthClauses = text.split(OUTCOME_CLAUSE_BREAK).filter((clause) => birthWording.test(clause));
  if (
    birthClauses.length &&
    birthClauses.every(
      (clause) =>
        !/\b(?:not|never|hasn't|hadn't)\s+(?:yet\s+)?(?:foaled|given birth|born)|\bno birth\b/.test(clause) &&
        !UNCERTAIN_WORDING.test(clause),
    )
  )
    return 'foaling';

  // A breeding verb/noun (word-bounded to avoid "recovered"/"observed") marks
  // a cover. It outranks result words like "open"/"in foal", which often just
  // describe the mare's prior state in the same note ("open mare bred to
  // Thunder"). An explicit scan/check term flips it back to a pregnancy check.
  const hasBreedingVerb =
    /\b(?:bred|covered|served|inseminated|mated)\b|\b(?:live|natural)\s+cover\b/.test(text) &&
    !/\b(?:not|never|wasn't|isn't|hasn't)\s+(?:yet\s+)?(?:bred|covered|served|inseminated|mated)\b/.test(text);
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
  return `${details?.result ?? ''}. ${event.status ?? ''}. ${event.title}. ${event.summary}`.toLowerCase();
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
    const dueDate = addDays(toDate(isoDate(bredOn))!, template.day);
    const today = toDate(localIsoDate(now))!;
    const daysUntil = Math.round((dueDate.getTime() - today.getTime()) / DAY_MS);
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

function eventDay(event: TimelineEvent): number {
  return toDate(event.date)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

// Date-only entries have no observed clock time. Offset-bearing timestamps do.
function eventInstant(event: TimelineEvent): number | undefined {
  return breedingInstant(event.date);
}

function compareEventTime(left: TimelineEvent, right: TimelineEvent): number {
  const leftInstant = eventInstant(left);
  const rightInstant = eventInstant(right);
  return leftInstant !== undefined && rightInstant !== undefined
    ? leftInstant - rightInstant
    : eventDay(left) - eventDay(right);
}

function latestByRecordType(
  events: TimelineEvent[],
  recordType: BreedingRecordDetails['recordType'],
): TimelineEvent | undefined {
  return events.filter((event) => resolveRecordType(event) === recordType).sort((a, b) => compareEventTime(b, a))[0];
}

// A date-only boundary must also respect newest-first insertion order. Earlier
// same-day evidence belongs to the previous cycle, for both covers and foalings.
function eventsAfter(events: TimelineEvent[], boundary: TimelineEvent): TimelineEvent[] {
  const boundaryOrder = events.indexOf(boundary);
  return events.filter(
    (event, order) =>
      compareEventTime(event, boundary) > 0 ||
      (compareEventTime(event, boundary) === 0 &&
        (eventInstant(event) === undefined || eventInstant(boundary) === undefined) &&
        order < boundaryOrder),
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
 *     and "confirmed not pregnant" are open; bare "confirmed" stays unknown;
 *   - "negative for twins" is not a negative;
 *   - positive and negative wording in the same entry is unknown.
 *
 * Text matching used to read "Pregnancy check -- Negative, mare is not
 * pregnant" as in foal, because "pregnant" matched before anything looked at
 * the "not" in front of it.
 */
export type PregnancyCheckOutcome = 'positive' | 'negative' | 'unknown';

const NEGATIVE_WORDING =
  /\bopen\b|\bnegative\b(?!\s+for\s+twins?)|not.?in.?foal|not.?pregnant|\bbarren\b|\bempty\b|\b(?:pregnancy|foaling|embryonic|fetal) loss\b|\bmiscarri(?:age|ed)\b|\babortion\b|\b(?:pregnancy|foal|fetus|foetus)\s+(?:was\s+)?aborted\b|\baborted\s+(?:pregnancy|foal|fetus|foetus)\b|\bfetal (?:demise|death)\b|\bslipped\b|\blost\b|\bresorbed\b/;
const POSITIVE_WORDING =
  /in.?foal|\bpositive\b|\bpregnant\b|\bheartbeat\s+(?:seen|detected|present|confirmed)\b|\b(?:strong|present|detected)\s+heartbeat\b|\bsingle(?:ton)?\s+(?:pregnancy|embryo|vesicle)/g;
const CLAUSE_NEGATION = /\b(?:no|not|without|never|isn'?t|wasn'?t|yet to be)\b/;
// Free-text questions and uncertainty cannot establish a pregnancy outcome.
const UNCERTAIN_WORDING =
  /\?|\b(?:possibly|possible|maybe|likely|probably|probable|presumed|apparently|apparent|tentative|anticipated|anticipating|may be|may have|may not|might|could|should|would|not sure|not yet confirmed|not confirmed|unknown|uncertain|unclear|unconfirmed|inconclusive|unreadable|uninterpretable|equivocal|suspected|suspects|suspect|cannot|can't|could not|unable to|indeterminate)\b/;
const CLAUSE_BREAK = /[.;,:!?\n\u2013\u2014]|\s-\s/;

// Keep questions inside their clause so uncertainty is not lost when splitting.
const OUTCOME_CLAUSE_BREAK = /[.;,:\n\u2013\u2014]|\s-\s/;
const PREGNANCY_EVIDENCE_WORDING =
  /in.?foal|\b(?:open|barren|empty|pregnant|positive|negative|confirmed|heartbeat|embryo|vesicle|fetus|foetus|viability|nonviable|miscarriage|miscarried|abortion|abort|aborted|fetal|demise|death|dead|loss|slipped|lost|resorb\w*)\b|\bsingle(?:ton)?\s+pregnancy\b|\bpregnancy\s+(?:loss|viability|outcome|status)\b|\b(?:outcome|result|status)\b/;
const FOALING_EVIDENCE_WORDING =
  /\b(?:foaled|born|stillborn|aborted|abort|slipped|loss|dead|died|alive|live|living|delivered|delivery|outcome|result|status)\b|gave birth|healthy\s+(?:foal|colt|filly)|(?:foal|colt|filly).*\b(?:healthy|doing well)\b/;

function isAdministrativeOnlyBreedingNote(event: TimelineEvent): boolean {
  const rawResult = breedingDetails(event)?.result;
  if (typeof rawResult === 'string' && rawResult.trim()) return false;
  const text = `${event.title}. ${event.summary}`.toLowerCase();
  const appointment = /\b(?:appointment|booking)\b/;
  if (!appointment.test(text)) return false;
  // An administrative confirmation is not a newly observed check. Actual
  // clinical results in the same entry must still participate in chronology.
  const explicitClinical =
    /in.?foal|\bpregnant\b|\b(?:mare|uterus|scan|check|result)\s+(?:(?:is|was)\s+)?(?:open|positive|negative)\b|\b(?:pregnancy loss|miscarriage|abortion|fetal demise|fetal death)\b/;
  const uncertainClinical = (clause: string) =>
    /\b(?:scan|check|recheck|ultrasound|pregnancy|result)\b/.test(clause) &&
    /\b(?:inconclusive|unclear|unknown|unconfirmed|unreadable|uninterpretable|indeterminate|equivocal|unable|performed|completed|conducted)\b/.test(
      clause,
    );
  return !text
    .split(OUTCOME_CLAUSE_BREAK)
    .some((clause) =>
      appointment.test(clause)
        ? explicitClinical.test(clause) || uncertainClinical(clause)
        : PREGNANCY_EVIDENCE_WORDING.test(clause) || FOALING_EVIDENCE_WORDING.test(clause) || uncertainClinical(clause),
    );
}

function outcomeClauses(text: string, kind: 'pregnancy-check' | 'foaling'): string {
  const relevant = kind === 'foaling' ? FOALING_EVIDENCE_WORDING : PREGNANCY_EVIDENCE_WORDING;
  // Keep uncertain/contradictory prose by default, including standalone
  // qualifiers. Discard only clearly contextual follow-up advice that says
  // nothing about the reproductive outcome or viability.
  const followUpAdvice =
    /\b(?:recheck|rebreed|rebreeding|repeat|monitor|monitored|monitoring|treatment|treatments|veterinary care|vet care|extra feed|feeding|review cycle|review the cycle|follow[- ]?up|vaccination|vaccines?)\b/;
  const uncertainResult =
    /\b(?:inconclusive|equivocal|indeterminate|unclear|unconfirmed|unknown|uncertain|unreadable|uninterpretable)\b/;
  return text
    .split(OUTCOME_CLAUSE_BREAK)
    .filter((clause) => relevant.test(clause) || uncertainResult.test(clause) || !followUpAdvice.test(clause))
    .join('. ');
}

export function pregnancyCheckOutcome(event: TimelineEvent): PregnancyCheckOutcome {
  // Restored backups can carry any JSON here; only a string is a result.
  const rawResult: unknown = breedingDetails(event)?.result;
  const structured = typeof rawResult === 'string' ? rawResult.trim().toLowerCase() : '';
  if (structured === 'in-foal') return 'positive';
  if (structured === 'open') return 'negative';
  if (structured === 'pending') return 'unknown';

  // An OCR or imported result is still the most specific text there is.
  const text = outcomeClauses(
    (structured || `${event.status ?? ''}. ${event.title}. ${event.summary}`).toLowerCase(),
    'pregnancy-check',
  );
  if (
    UNCERTAIN_WORDING.test(text) ||
    /\b(?:result|positive|negative|pregnancy|foal)\b[^.;]*\b(?:expected|anticipated)\b/.test(text)
  )
    return 'unknown';
  // A positive phrase cannot override a missing/absent heartbeat in another clause.
  if (
    /\b(?:no|without|absent)\s+(?:fetal\s+)?heartbeat|\bheartbeat\s+(?:(?:was|is)\s+)?(?:not|absent|undetected)|\bnon[- ]?viable\b|\bno\s+(?:viable\s+)?(?:fetus|foetus|embryo)\b/.test(
      text,
    )
  )
    return 'unknown';
  const reproductiveLoss =
    /\b(?:pregnancy|foaling|embryonic|fetal) loss\b|\bmiscarriage\b|\babortion\b|\bfetal (?:demise|death)\b/;
  const ambiguousLoss = text.split(OUTCOME_CLAUSE_BREAK).some((clause) => {
    const loss = clause.match(reproductiveLoss);
    if (!loss || CLAUSE_NEGATION.test(clause.slice(0, loss.index))) return false;
    // A risk discussion or a bare topic is not an observed diagnosis.
    return (
      !/\b(?:confirmed|diagnosed|observed|documented|recorded|occurred|suffered|experienced)\b/.test(clause) ||
      /\b(?:risk|discussed|discuss|monitor|watch|prevent|prevention|if)\b/.test(clause)
    );
  });
  if (ambiguousLoss) return 'unknown';
  // Negating an open/negative description does not prove the opposite either.
  const negative = [...text.matchAll(new RegExp(NEGATIVE_WORDING.source, 'g'))].some((match) => {
    if (/^not/.test(match[0])) return true;
    const before = text.slice(0, match.index).split(CLAUSE_BREAK).pop() ?? '';
    return !CLAUSE_NEGATION.test(before);
  });
  let positive = false;
  for (const match of text.matchAll(POSITIVE_WORDING)) {
    const before = text.slice(0, match.index).split(CLAUSE_BREAK).pop() ?? '';
    const after = text.slice((match.index ?? 0) + match[0].length).split(CLAUSE_BREAK)[0] ?? '';
    if (CLAUSE_NEGATION.test(before) || CLAUSE_NEGATION.test(after)) continue;
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
 * Conflicting same-day checks remain unknown; array order is not an observation time.
 */
export function currentPregnancyOutcome(
  events: TimelineEvent[],
  afterISO: string,
  now = new Date(),
): PregnancyCheckOutcome {
  const boundaryInstant = breedingInstant(afterISO);
  const atOrAfterBoundary = (event: TimelineEvent) => {
    const instant = eventInstant(event);
    return instant !== undefined && boundaryInstant !== undefined
      ? instant >= boundaryInstant
      : eventDay(event) >= (toDate(afterISO)?.getTime() ?? Number.NEGATIVE_INFINITY);
  };
  const checks = chronologicalBreedingEvents(events, now)
    .map((event, order) => ({ event, order }))
    .filter(
      ({ event }) =>
        resolveRecordType(event) === 'pregnancy-check' && Number.isFinite(eventDay(event)) && atOrAfterBoundary(event),
    )
    .sort((a, b) => eventDay(b.event) - eventDay(a.event) || a.order - b.order);
  const nonPending = checks
    .map(({ event }) => event)
    .filter((event) => {
      const result = breedingDetails(event)?.result;
      return typeof result !== 'string' || result.trim().toLowerCase() !== 'pending';
    });
  // Keep every observation that cannot be proved older than another. A real
  // timestamp orders same-day checks; a day-only conflict must be reviewed.
  const latest = nonPending.filter((event) => !nonPending.some((other) => compareEventTime(other, event) > 0));
  if (!latest.length) return 'unknown';
  const outcomes = latest.map(pregnancyCheckOutcome);
  return outcomes.every((outcome) => outcome === outcomes[0]) ? outcomes[0]! : 'unknown';
}

/** A birth never proves a live outcome by the absence of loss wording. */
export function foalingOutcome(event: TimelineEvent): 'live' | 'loss' | 'unknown' {
  const raw = breedingDetails(event)?.result;
  const structured = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (structured === 'live' || structured === 'loss' || structured === 'unknown') return structured;
  const text = outcomeClauses(structured || outcomeText(event), 'foaling');
  if (UNCERTAIN_WORDING.test(text) || /\bunknown\b|unconfirmed|not recorded|pending/.test(text)) return 'unknown';
  let loss = false;
  let live = false;
  if (/\b(?:foal|colt|filly)\s+(?:is\s+|was\s+)?not alive\b|\bno live (?:foal|colt|filly)\b/.test(text)) loss = true;
  for (const match of text.matchAll(/\bloss\b|stillborn|still.?birth|\bdead\b|\bdied\b|abort|slipped/g)) {
    const before = text.slice(0, match.index);
    if (/\b(?:no(?: signs of| evidence of)?(?: foaling)?|not(?: a)?(?: foaling)?|without(?: any)?)\s+$/.test(before))
      continue;
    loss = true;
  }
  // A healthy mare is not evidence about the foal; negated statements are not positive outcomes.
  const liveWording =
    /\b(?:live|living|healthy)\s+(?:foal|colt|filly)\b|\b(?:foal|colt|filly)\s+(?:is\s+|was\s+|still\s+)?(?:alive|healthy|doing well)\b/g;
  for (const match of text.matchAll(liveWording)) {
    const before = text.slice(0, match.index).split(CLAUSE_BREAK).pop() ?? '';
    const after = text.slice((match.index ?? 0) + match[0].length).split(CLAUSE_BREAK)[0] ?? '';
    if (!CLAUSE_NEGATION.test(before) && !CLAUSE_NEGATION.test(after)) live = true;
  }
  return live && loss ? 'unknown' : loss ? 'loss' : live ? 'live' : 'unknown';
}

export function chronologicalBreedingEvents(events: TimelineEvent[], now = new Date()): TimelineEvent[] {
  return events
    .filter((event) => {
      if (!isOccurredBreedingEvent(event)) return false;
      const date = toDate(event.date);
      if (!date) return false;
      const instant = eventInstant(event);
      return instant !== undefined ? instant <= now.getTime() : isoDate(date) <= localIsoDate(now);
    })
    .sort((left, right) => compareEventTime(right, left));
}

// Contract records are evidence to review, never an automatically adjudicated
// entitlement. A foaling outcome alone cannot create or fulfil an agreement.
const GUARANTEE_LABELS: Record<GuaranteeState, string> = {
  'not-recorded': 'Guarantee not recorded',
  unconfirmed: 'Guarantee unconfirmed — review agreement',
  'conditions-pending': 'Guarantee conditions need review',
  excluded: 'Guarantee exclusion recorded',
  expired: 'Recorded claim deadline passed — review agreement',
  recorded: 'Guarantee terms recorded — entitlement needs review',
  'claim-review': 'Loss recorded — review guarantee claim',
};

function guaranteeFor(
  horse: HorseRecord,
  events: TimelineEvent[],
  breeding: TimelineEvent | undefined,
  status: MareStatus,
  now: Date,
): Pick<MareBreedingState, 'guarantee' | 'guaranteeLabel'> {
  const result = (guarantee: GuaranteeState) => ({ guarantee, guaranteeLabel: GUARANTEE_LABELS[guarantee] });
  if (!breeding || status === 'not-breeding') return result('not-recorded');
  const contracts = events.filter((event) => resolveRecordType(event) === 'contract');
  const linked = contracts.filter(
    (event) => breedingDetails(event)?.liveFoalGuarantee?.breedingEventId === breeding.id,
  );
  if (!linked.length) return result(contracts.length ? 'unconfirmed' : 'not-recorded');
  // Equally dated amendments need a person to select the authoritative terms.
  const contract = linked[0]!;
  if (linked.some((event) => event !== contract && eventDay(event) === eventDay(contract)))
    return result('unconfirmed');
  const details = breedingDetails(contract)!;
  const terms = details.liveFoalGuarantee!;
  const reviewed = toDate(terms.reviewedOn);
  if (
    !details.documentId ||
    !horse.documents?.includes(details.documentId) ||
    typeof terms.counterparty !== 'string' ||
    !terms.counterparty.trim() ||
    typeof terms.terms !== 'string' ||
    !terms.terms.trim() ||
    typeof terms.reviewedBy !== 'string' ||
    !terms.reviewedBy.trim() ||
    !reviewed ||
    isoDate(reviewed) > localIsoDate(now) ||
    eventDay(contract) > reviewed.getTime()
  )
    return result('unconfirmed');
  if (terms.coverage === 'excluded' || terms.conditionsReview === 'not-satisfied') return result('excluded');
  if (terms.coverage !== 'included' && terms.coverage !== 'conditional') return result('unconfirmed');
  if (terms.claimDeadline) {
    const deadline = toDate(terms.claimDeadline);
    if (!deadline) return result('unconfirmed');
    if (isoDate(deadline) < localIsoDate(now)) return result('expired');
  }
  if (terms.conditionsReview !== 'satisfied') return result('conditions-pending');
  return result(status === 'foaled-loss' ? 'claim-review' : 'recorded');
}

const STATUS_LABELS: Record<MareStatus, string> = {
  open: 'Open — ready to breed',
  'bred-awaiting-check': 'Bred — awaiting confirmation',
  'in-foal': 'Confirmed in foal',
  'near-term': 'Near term',
  'foaled-live': 'Foaled — live',
  'foaled-loss': 'Foaling loss',
  'foaling-unknown': 'Foaling recorded — outcome unconfirmed',
  'pregnancy-unknown': 'Pregnancy outcome unconfirmed',
  'not-breeding': 'Not in breeding program',
};

export function buildMareBreedingState(horse: HorseRecord, now: Date = new Date()): MareBreedingState {
  const events = chronologicalBreedingEvents(horse.breedingTimeline ?? [], now);
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
    bredOn: bredOn ? isoDate(bredOn) : undefined,
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
      ...guaranteeFor(horse, events, undefined, 'not-breeding', now),
      actionLabel: '',
      actionRoute: '/breeding',
    };
  }

  const foaling = latestByRecordType(events, 'foaling');
  // Day-only dates need the timeline's newest-first order to separate cycles.
  const completedCycle =
    foaling &&
    (!breeding ||
      compareEventTime(foaling, breeding) > 0 ||
      (compareEventTime(foaling, breeding) === 0 &&
        (eventInstant(foaling) === undefined || eventInstant(breeding) === undefined) &&
        events.indexOf(foaling) < events.indexOf(breeding)));

  if (!breeding || !bredOn || completedCycle) {
    // A mare can arrive already in foal: a positive check with no cover on file
    // is in foal, not open. Her due date is unknown and is never invented from
    // the check, so she has no foaling window until the cover is logged. Checks
    // from before her latest foaling belong to an earlier pregnancy.
    const currentEvents = foaling ? eventsAfter(events, foaling) : events;
    if (currentPregnancyOutcome(currentEvents, '', now) === 'positive') {
      return {
        ...base,
        status: 'in-foal',
        statusLabel: STATUS_LABELS['in-foal'],
        // A completed cover cannot provide dates or a sire for this pregnancy.
        bredOn: undefined,
        mateName: undefined,
        method: undefined,
        ...guaranteeFor(horse, events, undefined, 'not-breeding', now),
        actionLabel: `Log the cover date for ${horse.name} to track her foaling window`,
        actionRoute: '/breeding',
      };
    }
    const latestCheck = latestByRecordType(currentEvents, 'pregnancy-check');
    if (latestCheck) {
      const outcome = currentPregnancyOutcome(currentEvents, '', now);
      const status: MareStatus = outcome === 'negative' ? 'open' : 'pregnancy-unknown';
      return {
        ...base,
        status,
        statusLabel: STATUS_LABELS[status],
        bredOn: undefined,
        mateName: undefined,
        method: undefined,
        ...guaranteeFor(horse, events, undefined, 'not-breeding', now),
        actionLabel:
          outcome === 'negative'
            ? `Log a breeding for ${horse.name}`
            : `Confirm the pregnancy outcome for ${horse.name}`,
        actionRoute: '/breeding',
      };
    }
    if (foaling && completedCycle) {
      const episode = breeding ? eventsAfter(events, breeding) : events;
      const births = episode.filter((event) => resolveRecordType(event) === 'foaling');
      const latestBirths = births.filter((event) => !births.some((other) => compareEventTime(other, event) > 0));
      const outcomes = latestBirths.map(foalingOutcome);
      const outcome = outcomes.length && outcomes.every((value) => value === outcomes[0]) ? outcomes[0]! : 'unknown';
      const status: MareStatus =
        outcome === 'live' ? 'foaled-live' : outcome === 'loss' ? 'foaled-loss' : 'foaling-unknown';
      return {
        ...base,
        status,
        statusLabel: STATUS_LABELS[status],
        ...guaranteeFor(horse, events, breeding, status, now),
        actionLabel:
          outcome === 'live'
            ? `Register the foal for ${horse.name}`
            : outcome === 'loss'
              ? `Review the recorded loss and veterinary follow-up for ${horse.name}`
              : `Confirm the foaling outcome for ${horse.name}`,
        actionRoute: '/breeding',
      };
    }
    return {
      ...base,
      status: 'open',
      statusLabel: 'No breeding outcome recorded',
      ...guaranteeFor(horse, events, undefined, 'not-breeding', now),
      actionLabel: `Log a breeding for ${horse.name}`,
      actionRoute: '/breeding',
    };
  }

  // Open again if the latest definite check came back negative.
  const currentCycleEvents = eventsAfter(events, breeding);
  const pregnancy = currentPregnancyOutcome(currentCycleEvents, breeding.date, now);
  if (pregnancy === 'negative') {
    return {
      ...base,
      status: 'open',
      statusLabel: STATUS_LABELS.open,
      ...guaranteeFor(horse, events, breeding, 'open', now),
      actionLabel: `Rebreed ${horse.name} this cycle`,
      actionRoute: '/breeding',
    };
  }

  const checkpoints = buildCheckpoints(bredOn, now);
  // Gestational day of the latest logged pregnancy check (−1 if none). A check
  // satisfies every earlier diagnostic checkpoint — a day-20 scan covers the
  // day-15 ultrasound — so those should not be surfaced as overdue.
  const latestCheckDay = currentCycleEvents.reduce((latest, event) => {
    if (resolveRecordType(event) !== 'pregnancy-check' || pregnancyCheckOutcome(event) === 'unknown') return latest;
    const day = Math.floor((eventDay(event) - bredOn.getTime()) / DAY_MS);
    return day >= 0 ? Math.max(latest, day) : latest;
  }, -1);
  const overdueCheckpoints = checkpoints.filter((checkpoint) => {
    if (checkpoint.status !== 'overdue' || !checkpoint.critical) return false;
    // A logged check supersedes diagnostic checkpoints at or before its day.
    if (checkpoint.kind === 'diagnostic' && checkpoint.dayOffset <= latestCheckDay) return false;
    const ageDays = (toDate(localIsoDate(now))!.getTime() - toDate(checkpoint.dueDate)!.getTime()) / DAY_MS;
    return ageDays <= RECENT_OVERDUE_WINDOW_DAYS;
  });
  const nextCheckpoint = checkpoints.find((checkpoint) => checkpoint.status !== 'overdue');

  const expectedFoaling = addDays(bredOn, GESTATION_MEAN_DAYS);
  const windowStart = addDays(bredOn, GESTATION_EARLY_DAYS);
  const windowEnd = addDays(bredOn, GESTATION_LATE_DAYS);
  const today = toDate(localIsoDate(now))!;
  const daysToFoaling = Math.round((expectedFoaling.getTime() - today.getTime()) / DAY_MS);

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
    ...guaranteeFor(horse, events, breeding, status, now),
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

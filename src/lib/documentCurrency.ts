import type { DocumentRecord } from '../types/xbar.js';

/*
 * Whether a document is CURRENT, answered in one place.
 *
 * It was answered in two, and they disagreed. The sale-packet gate asked for a
 * Ready document carrying an `examDate` inside the window; the revenue-risk
 * assessment accepted any Coggins that was not Archived and measured the
 * window from `uploadedAt`. So a rancher who uploaded a year-old Coggins this
 * morning, or whose upload was still sitting in Needs Review, had the packet
 * gate hold the horse back while the ranch report counted its full asking
 * price as ready to close — and the report is the number that reaches a
 * spreadsheet and a PDF.
 *
 * `uploadedAt` is when the file arrived, which says nothing about when the
 * blood was drawn. The exam date is the fact a buyer needs, and a document
 * nobody has reviewed has not established it. There is deliberately no
 * fallback to the upload date: a fallback is exactly the hole this closes.
 */

/** The minimum shape needed to judge a document's currency. */
export type DatedDocument = Pick<DocumentRecord, 'state' | 'entities'>;

/** A Coggins is good for twelve months from the exam. */
export const CURRENT_COGGINS_DAYS = 365;

const DAY_MS = 86_400_000;

/*
 * The calendar day an exam falls on, as a UTC-midnight timestamp.
 *
 * An exam date is a calendar date with no zone attached to it, so the only
 * honest comparison is day against day. A tolerance in milliseconds cannot
 * express that: 24 hours of slack admits a document dated genuinely tomorrow,
 * and anything less rejects a same-day exam recorded east of UTC. Normalizing
 * both sides to a day removes the choice.
 *
 * `Date.parse` reads a bare 'YYYY-MM-DD' as UTC midnight, and a stored record
 * may instead carry a full timestamp, so the exam side is reduced by its UTC
 * components — the day it was written down as.
 */
function examCalendarDay(examTime: number): number {
  const exam = new Date(examTime);
  return Date.UTC(exam.getUTCFullYear(), exam.getUTCMonth(), exam.getUTCDate());
}

/*
 * Today, in the zone of whoever is looking.
 *
 * Deliberately local rather than UTC. A rancher in UTC+13 recording this
 * morning's Coggins is not filing a future document, and one in UTC-10 should
 * not have tomorrow's date accepted because it is already tomorrow in London.
 */
function localCalendarDay(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

export function isDocumentReady(document: Pick<DocumentRecord, 'state'>): boolean {
  return document.state === 'Ready';
}

export function isDocumentResolved(document: Pick<DocumentRecord, 'state'>): boolean {
  return document.state === 'Ready' || document.state === 'Matched' || document.state === 'Archived';
}

export function documentExamTime(document: DatedDocument): number | null {
  // Optional at runtime whatever the type says: these records come back from
  // browser storage, and one restored without entities must not throw here.
  const examDate = document.entities?.examDate;
  if (!examDate) return null;
  const parsed = Date.parse(examDate);
  return Number.isNaN(parsed) ? null : parsed;
}

export function isCurrentDatedDocument(document: DatedDocument, maxAgeDays: number, now: Date = new Date()): boolean {
  const examTime = documentExamTime(document);
  if (examTime === null) return false;
  // An exam cannot have happened yet. Without this the window is open-ended on
  // the near side, so a typo'd year clears a sale blocker and moves an asking
  // price into ready-to-close value on the strength of a date nobody could have
  // examined a horse on. Day against day, so tomorrow is refused however few
  // hours away it is, and today is accepted whatever the clock says.
  if (examCalendarDay(examTime) > localCalendarDay(now)) return false;
  return now.getTime() - examTime <= maxAgeDays * DAY_MS;
}

/** A document that has been reviewed AND whose exam is still inside the window. */
export function hasCurrentReadyDocument(
  documents: DatedDocument[],
  maxAgeDays: number,
  now: Date = new Date(),
): boolean {
  return documents.some((document) => isDocumentReady(document) && isCurrentDatedDocument(document, maxAgeDays, now));
}

/**
 * A document someone has already dealt with that still cannot be relied on.
 *
 * This is what separates "nothing was uploaded" from "what was uploaded does
 * not carry a current exam date", and the two need different things done about
 * them — one is an upload, the other is a correction.
 */
export function hasResolvedDocumentMissingCurrentDate(
  documents: DatedDocument[],
  maxAgeDays: number,
  now: Date = new Date(),
): boolean {
  return documents.some(
    (document) => isDocumentResolved(document) && !isCurrentDatedDocument(document, maxAgeDays, now),
  );
}

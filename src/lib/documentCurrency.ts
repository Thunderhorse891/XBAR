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

// examDate is a calendar date, so Date.parse reads it as UTC midnight. Someone
// in UTC+13 recording today's exam produces a timestamp up to about fourteen
// hours ahead of a UTC clock, and a device clock can drift further still. One
// day of slack lets a genuine same-day exam through while a wrong year — the
// case worth catching — is off by hundreds of them.
const FUTURE_EXAM_TOLERANCE_MS = DAY_MS;

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
  const age = now.getTime() - examTime;
  // An exam cannot have happened yet. Without this the window is open-ended on
  // the near side, so a typo'd year clears a sale blocker and moves an asking
  // price into ready-to-close value on the strength of a date nobody could have
  // examined a horse on.
  if (age < -FUTURE_EXAM_TOLERANCE_MS) return false;
  return age <= maxAgeDays * DAY_MS;
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

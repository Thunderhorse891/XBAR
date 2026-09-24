import type { DocumentRecord, HorseRecord } from '../types/xbar.js';
import type { ReminderItem } from '../features/reminders/types.js';
import type { CareBoardRow } from './dashboardOps.js';
import { CURRENT_COGGINS_DAYS, documentExamTime } from './documentCurrency.js';
import { formatCurrency } from './format.js';

/*
 * The expiry radar: which time-sensitive documents run out, and when.
 *
 * Read-only by design. It never writes to a document — not a date, not a
 * state, not an archive flag. Every expiry comes from one of two places:
 *
 *   - An exam date plus the rule XBAR already applies to that paper:
 *     Coggins for twelve months (CURRENT_COGGINS_DAYS, the same window the
 *     sale-packet gate and the revenue report use, so the three can never
 *     disagree), and a health certificate for the usual 30-day interstate
 *     window.
 *   - An expiry date printed on the document itself, read from the stored
 *     OCR text only when it sits right after a label such as "Expiration
 *     date" or "Valid through" — and only when every labelled date agrees.
 *
 * When neither gives a date, the document is listed as undated. A guessed
 * expiry is worse than none: nobody checks a date that looks right.
 */

export type ExpiryKind = 'Coggins' | 'Health certificate' | 'Insurance' | 'Contract';
export type ExpiryUrgency = 'expired' | 'under30' | 'under90' | 'current' | 'undated';

/** A health certificate (CVI) is usually good for 30 days of interstate travel. */
export const HEALTH_CERTIFICATE_DAYS = 30;
export const EXPIRY_SOON_DAYS = 30;
export const EXPIRY_WATCH_DAYS = 90;

const DAY_MS = 86_400_000;

export type DocumentExpiryItem = {
  documentId: string;
  title: string;
  kind: ExpiryKind;
  horseId?: string;
  /** The horse's name, or null for a document not linked to a horse. */
  horseName: string | null;
  /** Last day the document is good for, 'YYYY-MM-DD'; null when undated. */
  expiresOn: string | null;
  /** Days from today to `expiresOn`; negative once expired. */
  daysLeft: number | null;
  urgency: ExpiryUrgency;
  /** Where the date came from, in plain words. */
  basis: string;
  /** False while the document still waits in review — its dates are unconfirmed. */
  reviewed: boolean;
  /**
   * A newer paper of the same kind for the same horse is waiting in review.
   * Set on a confirmed paper that is still listed because an unreviewed one
   * cannot replace it until someone approves it.
   */
  renewalInReview?: boolean;
};

export type ExpiryRadar = {
  items: DocumentExpiryItem[];
  expired: DocumentExpiryItem[];
  under30: DocumentExpiryItem[];
  under90: DocumentExpiryItem[];
  undated: DocumentExpiryItem[];
  /** Papers good for more than 90 days. They still count as on file. */
  current: DocumentExpiryItem[];
  /**
   * Current papers nobody has approved yet, linked to a horse — usually this
   * year's renewal waiting beside last year's expired one. Listed, so the
   * renewal the expired row points to can be seen; they need review, not
   * renewal.
   */
  inReview: DocumentExpiryItem[];
  /** Current papers that are reviewed, and so not listed. */
  currentCount: number;
  /** Expired plus under 30 days — what the nav badge counts. */
  attentionCount: number;
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAME =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_PATTERN = `(\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}|\\d{4}-\\d{2}-\\d{2}|${MONTH_NAME}\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+${MONTH_NAME}\\.?,?\\s+\\d{4})`;
const EXPIRY_LABEL =
  '(?:expir(?:es|ation|y)(?:\\s+date)?|exp\\.?\\s+date|valid\\s+(?:through|thru|until|to)|good\\s+(?:through|thru|until)|(?:policy|coverage|contract|agreement|term)\\s+(?:ends?|ending|end\\s+date|expires?)|end\\s+date|terminat(?:es|ion)(?:\\s+date)?)';
const LABELLED_DATE = new RegExp(`${EXPIRY_LABEL}(?:\\s+on)?\\s*[:\\-–]?\\s*${DATE_PATTERN}`, 'gi');
const PERIOD_RANGE = new RegExp(
  `(?:policy|coverage|contract|agreement)?\\s*(?:period|term)\\s*(?:of\\s+coverage)?\\s*[:\\-–]?\\s*(?:from\\s+)?${DATE_PATTERN}\\s*(?:to|through|thru|-|–)\\s*${DATE_PATTERN}`,
  'gi',
);

function dayNumber(year: number, month: number, day: number): number | null {
  if (year < 2000 || year > 2100) return null;
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return time / DAY_MS;
}

/** A printed date as a day number; US month/day order for slashed dates. */
function parsePrintedDate(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  let match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (match) return dayNumber(Number(match[3]), Number(match[1]), Number(match[2]));
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return dayNumber(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[1]!.slice(0, 3)) + 1;
    return month ? dayNumber(Number(match[3]), month, Number(match[2])) : null;
  }
  match = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[2]!.slice(0, 3)) + 1;
    return month ? dayNumber(Number(match[3]), month, Number(match[1])) : null;
  }
  return null;
}

function isoDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The expiry date printed on a document, as 'YYYY-MM-DD', or null.
 *
 * Only a date directly after an expiry label counts, or the end of a stated
 * policy or contract period. Two labelled dates that disagree return null:
 * picking one would be a guess.
 */
export function findPrintedExpiryDate(text: string | undefined): string | null {
  const source = String(text ?? '');
  if (!source.trim()) return null;
  const found = new Set<number>();
  for (const match of source.matchAll(LABELLED_DATE)) {
    const day = parsePrintedDate(match[1] ?? '');
    if (day !== null) found.add(day);
  }
  for (const match of source.matchAll(PERIOD_RANGE)) {
    // DATE_PATTERN captures three groups (the date and two month names), so
    // the period's start is group 1 and its end is group 4. Both must read.
    const startDay = parsePrintedDate(match[1] ?? '');
    const endDay = parsePrintedDate(match[4] ?? '');
    if (startDay !== null && endDay !== null && endDay > startDay) found.add(endDay);
  }
  return found.size === 1 ? isoDay([...found][0]!) : null;
}

/*
 * A health certificate carries other dates with expiry labels on it — a
 * rabies vaccination, an EIA test "valid through" next spring. Those say
 * nothing about when the certificate itself lapses, so only a date the
 * certificate gives for ITSELF counts ("This certificate is valid through",
 * "Certificate expiration date", "CVI valid until"). Anything else falls back
 * to the inspection window.
 */
const CERTIFICATE_DATE = new RegExp(
  `(?:(?:this\\s+)?(?:health\\s+)?certificate(?:\\s+of\\s+veterinary\\s+inspection)?(?:\\s*\\(CVI\\))?|\\bCVI)[ \\t]+(?:is[ \\t]+)?(?:expir(?:es|ation)(?:\\s+date)?|valid\\s+(?:through|thru|until|to)|good\\s+(?:through|thru|until))(?:\\s+on)?\\s*[:\\-–]?\\s*${DATE_PATTERN}`,
  'gi',
);

/*
 * A bare "certificate" is the paper's own only where it opens a field — at
 * the start of the text, a new line, after punctuation, or after the wider gap
 * OCR leaves between columns ("Certificate expiration date: …"). Mid-sentence
 * it names something else: "Rabies vaccination certificate valid through
 * 05/01/2027" is the vaccination's certificate, not the CVI's. "This
 * certificate", "health certificate", the formal name and "CVI" say whose it
 * is, so they need no such check — but only on their own line: "Required for
 * CVI" followed by a vaccine's "Expiration Date:" on the next is not "CVI
 * expires". Refusing a doubtful bare label costs only the fallback to the
 * 30-day inspection window.
 */
const BARE_CERTIFICATE_LABEL = /^certificate(?!\s+of\s+veterinary\s+inspection)/i;
const THIS_CERTIFICATE_LABEL = /^this\s+certificate\b/i;
const FIELD_START = /(?:^|[\n\r.:;|•(]\s*|\s{2,})$/;

function namesThisCertificate(match: RegExpMatchArray, text: string): boolean {
  const index = match.index ?? 0;
  // "This certificate" means whichever certificate it sits in: in a "Rabies
  // Vaccination Certificate" section it is the vaccination's.
  if (THIS_CERTIFICATE_LABEL.test(match[0])) return inCertificateHeader(index, text);
  if (!BARE_CERTIFICATE_LABEL.test(match[0])) return true;
  return FIELD_START.test(text.slice(0, index)) && inCertificateHeader(index, text);
}

/*
 * An eCVI also prints its validity as a field of its own — "Expiration Date:"
 * or "Valid Through:" on a line of its own, below the heading rather than
 * beside the certificate's name. A generic expiry label counts only there, at
 * the start of a line: after a vaccine or test on the same line, or across a
 * table's column gap, it belongs to that component.
 */
const LINE_START = /(?:^|[\n\r])[ \t]*$/;
/*
 * Only the validity labels a certificate uses for itself. LABELLED_DATE also
 * knows "Policy expires", "Contract ends", "Term ends" and "End date" — labels
 * that name another paper, which a line break does not make the certificate's.
 */
const VALIDITY_DATE = new RegExp(
  `(?:expir(?:es|ation|y)(?:\\s+date)?|exp\\.?\\s+date|valid\\s+(?:through|thru|until|to)|good\\s+(?:through|thru|until))(?:\\s+on)?\\s*[:\\-–]?\\s*${DATE_PATTERN}`,
  'gi',
);

/*
 * A line to itself is not enough: a CVI lists vaccines and tests as sections
 * of their own ("Rabies Vaccination" / "Expiration Date: 05/01/2027"), and
 * their fields look exactly like the certificate's. So a validity field, or a
 * bare "Certificate …" label, counts only in the certificate's own header:
 * from its heading (the first time the paper names itself) to the first line
 * that names a vaccine, test, lab or batch. A later mention of the CVI inside
 * a section ("Required for CVI") does not start a new header. A field XBAR
 * can't place falls back to the 30-day inspection window, which flags a
 * certificate early rather than showing a lapsed one as current. Labels that
 * name the certificate itself ("This certificate…", "CVI valid until…") need
 * no such check.
 */
const COMPONENT_SECTION =
  /vaccin|immuniz|rabies|coggins|\bEIA\b|\bELISA\b|\bAGID\b|\btest|influenza|rhino|strangles|west\s+nile|tetanus|encephal|\bEEE\b|\bWEE\b|potomac|\bPHF\b|booster|\bdose|\blot\s*(?:no|#|number)|\bserial|administered|\bgiven\b|laborator|\blab\b|sample|accession/i;

function inCertificateHeader(index: number, text: string): boolean {
  const heading = text.search(HEALTH_CERTIFICATE_TEXT);
  const start = heading < 0 ? 0 : heading;
  const section = text.slice(start).search(COMPONENT_SECTION);
  const end = section < 0 ? text.length : start + section;
  return index >= start && index < end;
}

function certificateValidityField(match: RegExpMatchArray, text: string): boolean {
  const index = match.index ?? 0;
  return LINE_START.test(text.slice(0, index)) && inCertificateHeader(index, text);
}

/** The date a health certificate prints for its own expiry, or null. Disagreeing dates return null. */
export function findCertificateExpiryDate(text: string | undefined): string | null {
  const found = new Set([
    ...labelledDays(text, CERTIFICATE_DATE, namesThisCertificate),
    ...labelledDays(text, VALIDITY_DATE, certificateValidityField),
  ]);
  return found.size === 1 ? isoDay([...found][0]!) : null;
}

/*
 * The inspection date printed on a certificate, for one with no exam date on
 * record. Local intake reads an exam date only for papers it filed as Vet
 * Record or Coggins, so a CVI it filed as Registration arrives with none.
 * Only a labelled date counts ("Inspection Date", "Date of Inspection",
 * "Examination Date"): the first date anywhere on the paper could be a
 * vaccination or a foaling date.
 */
const INSPECTION_DATE = new RegExp(
  `(?:date\\s+of\\s+(?:inspection|examination|exam)|(?:inspection|examination|exam)\\s+date|date\\s+(?:inspected|examined))(?:\\s+on)?\\s*[:\\-–]?\\s*${DATE_PATTERN}`,
  'gi',
);

/** Every distinct day the pattern labels in the text, keeping only the matches `accept` allows. */
function labelledDays(
  text: string | undefined,
  pattern: RegExp,
  accept: (match: RegExpMatchArray, text: string) => boolean = () => true,
): Set<number> {
  const source = String(text ?? '');
  const found = new Set<number>();
  for (const match of source.matchAll(pattern)) {
    if (!accept(match, source)) continue;
    const day = parsePrintedDate(match[1] ?? '');
    if (day !== null) found.add(day);
  }
  return found;
}

/** Every date the pattern labels, as one day number; null when there is none or they disagree. */
function singleLabelledDay(text: string | undefined, pattern: RegExp): number | null {
  const found = labelledDays(text, pattern);
  return found.size === 1 ? [...found][0]! : null;
}

const HEALTH_CERTIFICATE_TEXT =
  /health\s+certificate|certificate\s+of\s+veterinary\s+inspection|\bCVI\b|interstate\s+health/i;
/*
 * "Policy" alone is not insurance: a stable's biosecurity or vaccination
 * policy can carry a date too, and reading it as a lapsed insurance policy
 * would claim the horse's insured value is uncovered. A name or heading says
 * insurance when it says so, or names the cover a policy gives.
 */
const INSURANCE_NAME =
  /\binsurance\b|\b(?:liability|mortality|major\s+medical|medical|surgical|property|loss\s+of\s+use|equine|farm)\s+(?:policy|coverage|cover)\b/i;
const INSURANCE_TEXT =
  /\binsurance\s+(?:policy|certificate|binder)\b|\bcertificate\s+of\s+(?:liability\s+)?insurance\b|\bpolicy\s+(?:number|no\.?|#)|\bnamed\s+insured\b|\bdeclarations\s+page\b/i;
const CONTRACT_NAME = /\b(?:contract|agreement|lease)\b/i;
const CONTRACT_TEXT = /\b(?:breeding|stallion\s+service|service|lease|boarding)\s+(?:contract|agreement)\b/i;

/*
 * The types an intake gives a paper it could not place. Local intake types a
 * file by its name alone and files anything it doesn't recognise as
 * Registration — "CVI.pdf", "Farm Liability Policy.pdf" and "Stallion
 * Service Agreement.pdf" among them. The server's classifier files what it
 * can't place as Ownership Memo. Review can't change a type, so for these two
 * the paper's own name and text decide whether it is a certificate, a policy
 * or an agreement. A type the intake did recognise is never second-guessed.
 *
 * The name is the paper's identity and decides first. The body is read only
 * when the name says nothing, and then only for identity — its heading, or a
 * phrase only that kind of paper prints — because bodies mention other papers:
 * a service agreement requires "a current health certificate", a policy
 * requires a CVI. When the name, or else the body, points to more than one
 * kind, nothing is claimed — a paper left off the radar is better than one
 * listed as the wrong kind with the wrong date.
 *
 * Recognising the paper is not dating it: a policy or agreement still gets a
 * date only from a labelled date printed on it, and an expiry label alone
 * does not make an unplaced paper expire.
 */
const UNPLACED_TYPES: ReadonlySet<DocumentRecord['type']> = new Set(['Registration', 'Ownership Memo']);

/*
 * A paper about a certificate, policy or contract is not one: "CVI
 * Requirements", "Coggins Instructions", "Insurance Requirements", "Lease
 * Agreement Template". Intake types by filename, so such a sheet can arrive
 * typed Insurance or Coggins; its expiry label would otherwise read as a lapsed
 * policy or a current certificate. Its name or heading saying so is enough.
 */
const REFERENCE_DOCUMENT =
  /\b(?:requirements?|checklists?|instructions?|guide(?:lines)?|rules|procedures?|how\s+to|faq|templates?|blank|sample)\b/i;

/** Which time-sensitive paper a document is, or null when it does not expire. */
export function expiryKindOf(
  document: Pick<DocumentRecord, 'type' | 'title' | 'extractedTextPreview'>,
): ExpiryKind | null {
  if (REFERENCE_DOCUMENT.test(document.title ?? '')) return null;
  if (document.type === 'Coggins') return 'Coggins';
  if (document.type === 'Insurance') return 'Insurance';
  if (document.type === 'Breeding Contract') return 'Contract';
  const title = document.title ?? '';
  const text = document.extractedTextPreview ?? '';
  if (document.type === 'Vet Record') {
    return HEALTH_CERTIFICATE_TEXT.test(`${title} ${text}`) ? 'Health certificate' : null;
  }
  if (!UNPLACED_TYPES.has(document.type)) return null;
  const byName = onlyKind([
    ['Health certificate', HEALTH_CERTIFICATE_TEXT.test(title)],
    ['Insurance', INSURANCE_NAME.test(title)],
    ['Contract', CONTRACT_NAME.test(title)],
  ]);
  if (byName !== undefined) return byName;
  // With no name, the body must say what the paper IS, not what it mentions:
  // its heading, or a phrase only that kind of paper prints.
  const heading = headingOf(text);
  if (REFERENCE_DOCUMENT.test(heading)) return null;
  return (
    onlyKind([
      ['Health certificate', HEALTH_CERTIFICATE_TEXT.test(heading) || CVI_TITLE_LINE.test(text)],
      ['Insurance', INSURANCE_NAME.test(heading) || INSURANCE_FIELD_LINE.test(text)],
      ['Contract', CONTRACT_NAME.test(heading) || CONTRACT_TITLE_LINE.test(text)],
    ]) ?? null
  );
}

/*
 * A paper's own heading: its first non-empty line, as far as a title runs.
 * "Horse Purchase Agreement" heads an agreement whose body asks for "a current
 * CVI"; the mention says nothing about what the paper is. Past the heading, an
 * identity phrase counts only where it opens a line — a title or a field: the
 * formal "Certificate of Veterinary Inspection" under an agency heading,
 * "Policy Number:", "Named Insured:", "Stallion Service Agreement". Inside a
 * sentence ("A current Certificate of Veterinary Inspection is required",
 * "subject to the existing lease agreement") it is a mention.
 */
const HEADING_LENGTH = 120;
const FORMAL_CVI_NAME = /certificate\s+of\s+veterinary\s+inspection/i;
const opensALineWith = (pattern: RegExp) => new RegExp(`(?:^|[\\r\\n])[ \\t]*(?:${pattern.source})`, 'i');
const CVI_TITLE_LINE = opensALineWith(FORMAL_CVI_NAME);
const INSURANCE_FIELD_LINE = opensALineWith(INSURANCE_TEXT);
const CONTRACT_TITLE_LINE = opensALineWith(CONTRACT_TEXT);

function headingOf(text: string): string {
  return (text.split(/[\r\n]+/).find((line) => line.trim()) ?? '').slice(0, HEADING_LENGTH);
}

/** The one kind that matched; null when several did; undefined when none did. */
function onlyKind(signals: Array<[ExpiryKind, boolean]>): ExpiryKind | null | undefined {
  const kinds = signals.filter(([, matched]) => matched).map(([kind]) => kind);
  if (!kinds.length) return undefined;
  return kinds.length === 1 ? kinds[0]! : null;
}

function localDay(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
}

function examDay(document: DocumentRecord): number | null {
  const time = documentExamTime(document);
  if (time === null) return null;
  const exam = new Date(time);
  return Date.UTC(exam.getUTCFullYear(), exam.getUTCMonth(), exam.getUTCDate()) / DAY_MS;
}

function readableDay(day: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(day * DAY_MS),
  );
}

/*
 * An exam that has not happened yet is a mistyped date, not a fresh paper.
 * isCurrentDatedDocument refuses it for the sale-packet gate; adding a window
 * to it here would call it current — and let it stand in for a Coggins that
 * has really expired. So it is listed as undated, for a person to correct.
 */
function futureExam(noun: string) {
  return { day: null, basis: `The ${noun} date on this document is after today — check it against the paper.` };
}

function resolveExpiry(
  document: DocumentRecord,
  kind: ExpiryKind,
  today: number,
): { day: number | null; basis: string } {
  if (kind === 'Coggins') {
    const exam = examDay(document);
    if (exam !== null && exam > today) return futureExam('exam');
    return exam === null
      ? { day: null, basis: 'No exam date on this Coggins, so XBAR can’t tell when it runs out.' }
      : { day: exam + CURRENT_COGGINS_DAYS, basis: `12 months from the ${readableDay(exam)} test.` };
  }
  const printed =
    kind === 'Health certificate'
      ? findCertificateExpiryDate(document.extractedTextPreview)
      : findPrintedExpiryDate(document.extractedTextPreview);
  if (printed) {
    return {
      day: parsePrintedDate(printed),
      basis: 'Expiry date read from the document — check it against the paper.',
    };
  }
  if (kind === 'Health certificate') {
    const stored = examDay(document);
    const printed = stored === null ? singleLabelledDay(document.extractedTextPreview, INSPECTION_DATE) : null;
    const exam = stored ?? printed;
    if (exam !== null && exam > today) return futureExam('inspection');
    return exam === null
      ? { day: null, basis: 'No inspection date on this certificate, so XBAR can’t tell when it runs out.' }
      : {
          day: exam + HEALTH_CERTIFICATE_DAYS,
          basis:
            printed === null
              ? `30 days from the ${readableDay(exam)} inspection — the usual interstate window; some states differ.`
              : `30 days from the ${readableDay(exam)} inspection read from the certificate — the usual interstate window; some states differ. Check it against the paper.`,
        };
  }
  return { day: null, basis: 'No expiry date XBAR can read on this document — check the paper.' };
}

function urgencyFor(daysLeft: number | null): ExpiryUrgency {
  if (daysLeft === null) return 'undated';
  if (daysLeft < 0) return 'expired';
  if (daysLeft < EXPIRY_SOON_DAYS) return 'under30';
  if (daysLeft < EXPIRY_WATCH_DAYS) return 'under90';
  return 'current';
}

export function buildExpiryRadar(
  documents: DocumentRecord[],
  horses: Pick<HorseRecord, 'id' | 'name'>[],
  now: Date = new Date(),
): ExpiryRadar {
  const today = localDay(now);
  const horseNames = new Map(horses.map((horse) => [horse.id, horse.name]));

  const candidates: DocumentExpiryItem[] = documents.flatMap((document) => {
    // Archived is the rancher saying a paper is superseded; Queued has not been read yet.
    if (document.state === 'Archived' || document.state === 'Queued') return [];
    const kind = expiryKindOf(document);
    if (!kind) return [];
    const { day, basis } = resolveExpiry(document, kind, today);
    const daysLeft = day === null ? null : day - today;
    const linked = document.horseId && horseNames.has(document.horseId) ? document.horseId : undefined;
    return [
      {
        documentId: document.id,
        title: document.title,
        kind,
        horseId: linked,
        horseName: linked ? (horseNames.get(linked) ?? null) : null,
        expiresOn: day === null ? null : isoDay(day),
        daysLeft,
        urgency: urgencyFor(daysLeft),
        basis,
        reviewed: document.state === 'Ready',
      },
    ];
  });

  /*
   * A renewal replaces the paper it renews — but only where one paper per
   * horse is the rule. A horse has one Coggins and one health certificate at a
   * time, so the dated one that runs longest counts and last year's does not
   * read as expired beside this year's.
   *
   * Insurance and contracts are never merged. A horse can carry mortality and
   * major-medical cover, and a ranch liability and property policies, at once;
   * merging them let a current policy hide one that had lapsed. A renewed
   * policy is archived in Documents, which is what removes the old one here.
   *
   * Only a REVIEWED paper replaces another. An upload still in review has
   * unconfirmed dates, so it cannot hide a confirmed expiry: the confirmed
   * paper stays listed (marked "renewal in review") and the pending one is
   * listed beside it with its own "Not reviewed yet" flag. A pending paper
   * older than the confirmed one is superseded like any other.
   *
   * A paper not yet assigned to a horse is its own group: which horse it
   * renews is not known, so it cannot replace anything.
   *
   * A paper with no usable date always stays listed: it needs a person to look
   * at it, and a dated renewal beside it says nothing about what it is.
   */
  const groups = new Map<string, DocumentExpiryItem[]>();
  for (const item of candidates) {
    const renews = (item.kind === 'Coggins' || item.kind === 'Health certificate') && Boolean(item.horseId);
    const key = renews ? `${item.kind}:${item.horseId}` : `doc:${item.documentId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const byExpiry = (best: DocumentExpiryItem, item: DocumentExpiryItem) =>
    (item.daysLeft ?? 0) > (best.daysLeft ?? 0) ? item : best;
  const items: DocumentExpiryItem[] = [];
  for (const group of groups.values()) {
    const confirmed = group.filter((item) => item.daysLeft !== null && item.reviewed);
    const best = confirmed.length ? confirmed.reduce(byExpiry) : undefined;
    const pending = group.filter(
      (item) => item.daysLeft !== null && !item.reviewed && (!best || (item.daysLeft ?? 0) > (best.daysLeft ?? 0)),
    );
    if (best) items.push(pending.length ? { ...best, renewalInReview: true } : best);
    // With nothing confirmed, the pending papers keep the ordinary renewal rule among themselves.
    if (best) items.push(...pending);
    else if (pending.length) items.push(pending.reduce(byExpiry));
    items.push(...group.filter((item) => item.daysLeft === null));
  }

  const byDays = (left: DocumentExpiryItem, right: DocumentExpiryItem) =>
    (left.daysLeft ?? 0) - (right.daysLeft ?? 0) || left.title.localeCompare(right.title);
  const expired = items.filter((item) => item.urgency === 'expired').sort(byDays);
  const under30 = items.filter((item) => item.urgency === 'under30').sort(byDays);
  const under90 = items.filter((item) => item.urgency === 'under90').sort(byDays);
  const current = items.filter((item) => item.urgency === 'current').sort(byDays);
  // Approval needs a horse (reviewDocument refuses one without), so only a
  // paper linked to a horse can leave this group by being approved.
  const inReview = current.filter((item) => !item.reviewed && item.horseId);
  const undated = items
    .filter((item) => item.urgency === 'undated')
    .sort((left, right) => left.title.localeCompare(right.title));

  return {
    items: [...expired, ...under30, ...under90, ...inReview, ...undated],
    expired,
    under30,
    under90,
    undated,
    current,
    inReview,
    currentCount: current.length - inReview.length,
    attentionCount: expired.length + under30.length,
  };
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function distinctHorses(items: DocumentExpiryItem[]): string[] {
  return [...new Set(items.flatMap((item) => (item.horseId ? [item.horseId] : [])))];
}

/**
 * What the radar puts at risk, in the words a rancher would use.
 *
 * Dollar figures come only from the horse records themselves — asking price
 * and insured value — and appear only when they are on file.
 */
export function describeExpiryRisk(
  radar: ExpiryRadar,
  horses: Pick<HorseRecord, 'id' | 'sale' | 'insuredValue'>[],
): string[] {
  const byId = new Map(horses.map((horse) => [horse.id, horse]));
  const lines: string[] = [];
  /*
   * Claims are made only from reviewed papers. A date read off a paper still
   * in review is unconfirmed — an OCR slip on a policy would otherwise say a
   * horse's insured value is uncovered. Those papers get one line of their own
   * asking for review, and no dollar figure.
   */
  const expired = radar.expired.filter((item) => item.reviewed);
  const under30 = radar.under30.filter((item) => item.reviewed);

  const expiredCoggins = distinctHorses(expired.filter((item) => item.kind === 'Coggins'));
  if (expiredCoggins.length) {
    const asking = expiredCoggins.reduce((sum, id) => sum + Math.max(0, byId.get(id)?.sale?.askPrice ?? 0), 0);
    lines.push(
      `${plural(expiredCoggins.length, 'horse', 'horses')} can’t legally travel or sell until Coggins is renewed${
        asking > 0 ? ` — ${formatCurrency(asking)} in asking prices is on hold` : ''
      }.`,
    );
  }
  const soonCoggins = distinctHorses(under30.filter((item) => item.kind === 'Coggins'));
  if (soonCoggins.length) {
    lines.push(
      `${plural(soonCoggins.length, 'horse loses', 'horses lose')} travel and sale clearance within 30 days unless Coggins is redrawn.`,
    );
  }
  const expiredCertificates = distinctHorses(expired.filter((item) => item.kind === 'Health certificate'));
  if (expiredCertificates.length) {
    lines.push(
      `${plural(expiredCertificates.length, 'horse needs', 'horses need')} a new health certificate before crossing state lines.`,
    );
  }
  const expiredInsurance = expired.filter((item) => item.kind === 'Insurance');
  if (expiredInsurance.length) {
    /*
     * Nothing on file ties a horse's insured value to one policy, so a lapsed
     * major-medical beside a current mortality policy leaves that value
     * covered. The value is counted only for horses with no other policy on
     * file at all — current, running low, or undated.
     */
    const stillOnFile = new Set(
      [...radar.under30, ...radar.under90, ...radar.undated, ...radar.current]
        .filter((item) => item.kind === 'Insurance' && item.horseId)
        .map((item) => item.horseId),
    );
    const insured = distinctHorses(expiredInsurance)
      .filter((id) => !stillOnFile.has(id))
      .reduce((sum, id) => sum + Math.max(0, byId.get(id)?.insuredValue ?? 0), 0);
    lines.push(
      `${plural(expiredInsurance.length, 'insurance policy has', 'insurance policies have')} lapsed${
        insured > 0 ? ` — ${formatCurrency(insured)} of insured horse value has no current policy on file` : ''
      }.`,
    );
  }
  const soonInsurance = under30.filter((item) => item.kind === 'Insurance');
  if (soonInsurance.length) {
    lines.push(`${plural(soonInsurance.length, 'insurance policy ends', 'insurance policies end')} within 30 days.`);
  }
  const expiredContracts = expired.filter((item) => item.kind === 'Contract');
  if (expiredContracts.length) {
    lines.push(
      `${plural(expiredContracts.length, 'contract has', 'contracts have')} passed ${expiredContracts.length === 1 ? 'its' : 'their'} end date — renew or close ${expiredContracts.length === 1 ? 'it' : 'them'} before relying on the terms.`,
    );
  }
  const pending = [...radar.expired, ...radar.under30].filter((item) => !item.reviewed).length;
  if (pending) {
    lines.push(
      `${plural(pending, 'paper waiting in review reads', 'papers waiting in review read')} as expired or due within 30 days — confirm ${pending === 1 ? 'its date' : 'their dates'} in Documents before relying on ${pending === 1 ? 'it' : 'them'}.`,
    );
  }
  return lines;
}

/**
 * How many radar papers the notification bell adds.
 *
 * Everything expired or under 30 days, less what the bell already counts: a
 * paper still in review (the review count holds every Needs Review and
 * Matched document), and a Coggins the care count holds — one whose own care
 * signal is due (an expired Coggins is). A Coggins
 * that is only running low is a care watch, which the care count never
 * includes — even when the same horse is on it for a due wormer — so the
 * radar counts it.
 */
export function expiryBellCount(
  radar: ExpiryRadar,
  careBoard: ReadonlyArray<Pick<CareBoardRow, 'horseId' | 'signals'>>,
): number {
  const dueCoggins = new Set(
    careBoard
      .filter((row) => row.signals.some((signal) => signal.key === 'coggins' && signal.status === 'due'))
      .map((row) => row.horseId),
  );
  return [...radar.expired, ...radar.under30].filter(
    (item) =>
      // A paper still in review is already in the bell's review count.
      item.reviewed && !(item.kind === 'Coggins' && item.horseId && dueCoggins.has(item.horseId)),
  ).length;
}

/**
 * Radar entries for the Reminders queue and its alert digest.
 *
 * A Coggins is left out only when the care board already raises a Coggins
 * reminder for that horse (its Coggins signal is due or watch): a second one
 * for the same horse would be noise. The care board reads a single paper per
 * horse — the newest Ready Coggins, dated by upload when it has no exam date —
 * so a newer paper with no exam date, or a mistyped future one, can read as
 * clear there while the radar still holds last year's expired Coggins. That
 * one stays in, as does a Coggins with no horse on the roster, which has no
 * care row at all. A paper still in review is left out too: the queue already
 * carries a review reminder for it, and its date is not confirmed. Only what
 * needs attention now goes in — expired or under 30 days.
 */
export function expiryReminderItems(
  radar: ExpiryRadar,
  careBoard: ReadonlyArray<Pick<CareBoardRow, 'horseId' | 'signals'>>,
): ReminderItem[] {
  const cogginsOnCareBoard = new Set(
    careBoard
      .filter((row) => row.signals.some((signal) => signal.key === 'coggins' && signal.status !== 'clear'))
      .map((row) => row.horseId),
  );
  return (
    [...radar.expired, ...radar.under30]
      // A paper still in review already has a review reminder of its own.
      .filter((item) => item.reviewed)
      .filter((item) => !(item.kind === 'Coggins' && item.horseId && cogginsOnCareBoard.has(item.horseId)))
      .map((item): ReminderItem => ({
        id: `expiry-${item.documentId}`,
        kind: 'Documents',
        urgency: item.urgency === 'expired' ? 'Due' : 'Watch',
        title: `${item.kind} ${item.urgency === 'expired' ? 'expired' : 'expiring'}: ${item.title}`,
        horseId: item.horseId,
        horseName: item.horseName ?? undefined,
        dueDate: item.expiresOn ?? undefined,
        detail: item.basis,
        route: '/expiring',
      }))
  );
}

export type ExpiryRowAction = 'review-renewal' | 'review' | 'open-documents' | 'upload-renewal';

/**
 * What a radar row offers. A paper still in review has unconfirmed dates, so
 * it is reviewed before anyone uploads a duplicate — when it can be: approval
 * needs a horse, so a ranch-wide paper goes by its date instead.
 */
export function expiryRowAction(item: DocumentExpiryItem): ExpiryRowAction {
  if (item.renewalInReview) return 'review-renewal';
  if (!item.reviewed && item.horseId) return 'review';
  if (item.urgency === 'undated') return 'open-documents';
  return 'upload-renewal';
}

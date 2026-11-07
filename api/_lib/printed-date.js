// Pure printed-date parsing shared by browser and server OCR. No runtime IO.
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function calendarDate(year, month, day) {
  if (year < 1 || year > 9999) return '';
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizePrintedDate(raw) {
  const value = String(raw ?? '').trim();
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  if (match) return calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(value);
  if (match)
    return calendarDate(Number(match[3].length === 2 ? `20${match[3]}` : match[3]), Number(match[1]), Number(match[2]));
  const written = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value);
  const reversed = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(value);
  if (!written && !reversed) return '';
  const monthName = (written?.[1] ?? reversed[2]).toLowerCase();
  const month =
    MONTHS.findIndex(
      (name) => name === monthName || name.slice(0, 3) === monthName || (name === 'september' && monthName === 'sept'),
    ) + 1;
  return month ? calendarDate(Number((written ?? reversed)[3]), month, Number(written?.[2] ?? reversed[1])) : '';
}

const DATE_VALUE =
  '(?:\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[/.-]\\d{1,2}[/.-](?:\\d{4}|\\d{2})|[A-Za-z]+\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+[A-Za-z]+\\.?,?\\s+\\d{4})';

// Every matching label must agree. An invalid date is not evidence for a
// different valid date elsewhere; missing/ambiguous dates remain unknown.
export function readLabeledDate(text, labels) {
  const values = new Set();
  let patternIndex = -1;
  for (const [index, label] of labels.entries()) {
    const pattern = new RegExp(`\\b(?:${label})\\b\\s*[:#-]?\\s*(${DATE_VALUE})(?![\\w]|[/.\\-]\\d)`, 'gi');
    for (const match of String(text ?? '').matchAll(pattern)) {
      const value = normalizePrintedDate(match[1]);
      if (!value) return null;
      values.add(value);
      if (patternIndex < 0) patternIndex = index;
    }
  }
  return values.size === 1 ? { value: [...values][0], patternIndex } : null;
}

export function addOneCalendarYear(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || !normalizePrintedDate(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  // Feb 29's anniversary is the last day of February in a non-leap year.
  return calendarDate(year + 1, month, day) || (month === 2 && day === 29 ? calendarDate(year + 1, 2, 28) : '');
}

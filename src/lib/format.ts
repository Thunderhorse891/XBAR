const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

// For figures that live below a dollar's precision — cost per horse per day,
// price per bale — where rounding to whole dollars would erase the number.
const centsCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

function parseDateValue(value: string) {
  if (!value?.trim()) {
    return null;
  }

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Timestamp comparison that survives the nowStamp() format transition.
 *
 * New writes are absolute ISO UTC instants; records written before the
 * transition — or synced from a stale PWA tab that still writes the old
 * form — are local `YYYY-MM-DD HH:mm` wall-clock with no recorded offset.
 * An offset-free wall clock cannot be converted to an absolute instant, so
 * the legacy form is interpreted AS UTC: deterministic and identical on
 * every client. Parsing it in the viewer's timezone made identical synced
 * data pick different "latest" offers — and therefore different sale
 * prices and profit figures — in Chicago vs Los Angeles. The trade-off is
 * documented: a legacy stamp written west of UTC orders up to its UTC
 * offset away from the real instant, but every client agrees on the order,
 * and the mixed population shrinks as new ISO writes replace it. Raw
 * lexicographic comparison is worse — it mis-sorts a later legacy value
 * behind an earlier ISO one (`'2026-09-24 20:00'` <
 * `'2026-09-24T19:40:00.000Z'` as strings, later as instants). Missing or
 * unparseable values sort last.
 */
function parseTimestampInstant(value: string): number {
  if (!value?.trim()) {
    return Number.NEGATIVE_INFINITY;
  }
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const time = new Date(normalized).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

export function compareTimestampDesc(a: string | null | undefined, b: string | null | undefined): number {
  return parseTimestampInstant(b ?? '') - parseTimestampInstant(a ?? '');
}

/**
 * A day as YYYY-MM-DD on the viewer's own calendar. Date inputs and receipt
 * dates mean the local day; toISOString() gives the UTC one, which west of
 * UTC turns into tomorrow every evening.
 */
export function localIsoDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

export function formatCurrencyCents(value: number) {
  return centsCurrencyFormatter.format(value);
}

export function formatCompactCurrency(value: number) {
  return compactCurrencyFormatter.format(value);
}

export function formatPercent(value: number) {
  return `${percentFormatter.format(value)}%`;
}

export function formatDateLabel(value: string) {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return 'Not scheduled';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

export function formatDateTimeLabel(value: string) {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return 'Not available';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

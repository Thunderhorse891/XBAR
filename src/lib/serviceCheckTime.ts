/** Display the server instant in the reader's timezone, including the zone.
 * Never guess a day or substitute the device clock for missing server data. */
export function serviceCheckTime(value: string | null | undefined, locale?: string, timeZone?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  try {
    return {
      iso: instant.toISOString(),
      label: new Intl.DateTimeFormat(locale, {
        dateStyle: undefined,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
        ...(timeZone ? { timeZone } : {}),
      }).format(instant),
    };
  } catch {
    return null;
  }
}

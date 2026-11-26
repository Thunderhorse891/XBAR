/** Parse a database bigint without treating missing, malformed or fractional usage as zero. */
export function parseStorageBytes(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

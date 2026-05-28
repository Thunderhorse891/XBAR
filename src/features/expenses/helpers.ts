/**
 * Returns true when every non-empty entry in `values` (joined into one
 * string) contains the trimmed, lowercased `query`.  An empty query
 * always matches.
 */
export function matchesSearch(values: Array<string | undefined>, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values.filter(Boolean).join(' ').toLowerCase().includes(normalized);
}

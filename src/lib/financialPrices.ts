/** Read-model boundary: never coerce malformed stored prices into money. */
export function positiveRecordedPrice(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Zero means no counter was entered; a malformed selected counter is unknown,
 * not permission to silently substitute a different offer. */
export function recordedOfferPrice(counter: unknown, offer: unknown): number {
  const selected = counter === undefined || counter === null || counter === 0 ? offer : counter;
  return positiveRecordedPrice(selected);
}

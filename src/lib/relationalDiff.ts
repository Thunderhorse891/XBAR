/*
 * Which records a cloud save actually needs to write.
 *
 * Every save used to upsert every row of every table. A device whose copy was
 * an hour old therefore rewrote rows it had never touched -- with the hour-old
 * values -- over edits another phone had saved in between. Nothing failed and
 * nothing said so; the newer work simply reverted (the same-row half of audit
 * F01). It also meant a staff member's save rewrote tables their role has no
 * business touching, so the database could never let specialist roles save at
 * all (audit F04).
 *
 * A save now writes only the records that changed since the copy this device
 * last saved or loaded: the baseline. A record that is identical to the
 * baseline is left alone in the cloud, whatever the cloud holds for it now.
 *
 * Records are compared by their own content, not by the database row built
 * from them: those rows carry the save's timestamp, so they would differ on
 * every save and every record would look changed.
 *
 * Without a baseline -- first save of a workspace, a Push cloud that replaces
 * the cloud copy -- everything is written, which is what happened before.
 */

type Identified = { id?: unknown };

/** JSON with object keys in a fixed order, so equal records compare equal. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/**
 * The records in `current` that differ from, or are missing in, `baseline`.
 * With no baseline at all, every record.
 */
export function changedRecords<T extends Identified>(current: readonly T[], baseline: readonly T[] | undefined): T[] {
  if (!baseline) return [...current];
  const before = new Map<string, string>();
  for (const record of baseline) {
    if (typeof record?.id === 'string') before.set(record.id, stableStringify(record));
  }
  return current.filter((record) => {
    if (typeof record?.id !== 'string') return true;
    const previous = before.get(record.id);
    return previous === undefined || previous !== stableStringify(record);
  });
}

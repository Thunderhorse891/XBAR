/*
 * Records a person deleted on this device, waiting to be deleted in the cloud.
 *
 * Cloud saves used to delete every row this device did not have. That is
 * deletion by ABSENCE, and absence is not a decision anyone made: a second
 * phone that loaded the ranch an hour ago does not have the horse added since,
 * and its next autosave erased that horse for everyone. So did a CSV import
 * written server-side, which no open device had yet. Nothing was wrong on the
 * device that did it; it simply had not seen the newer rows.
 *
 * A delete now has to be an ACT: the actions that remove a record queue it
 * here, and an ordinary save deletes exactly what is queued. A row the device
 * merely lacks is left alone. The one save that may still remove by absence is
 * Settings > Push cloud, where a person has chosen "make the cloud match this
 * device" -- that is a decision, made by someone looking at the conflict.
 *
 * Kept in browser storage, beside the records-owner marker and outside the
 * workspace backup, for the same reason that marker is: it describes THIS
 * device's unsent work, not the workspace. Carried in a backup it would replay
 * deletions on whatever device restored it. A memory copy covers a browser
 * that blocks storage, for the life of the page -- and only that: a queue that
 * could not be written does not survive a reload, and then the record is still
 * in the cloud, which is the safe direction to be wrong in.
 */
import { readBrowserStorage, writeBrowserStorage } from './browserStorage.js';

export type CloudDeletionTable = 'horses' | 'sales_leads' | 'expense_receipts' | 'ranch_assets';

export interface CloudDeletion {
  table: CloudDeletionTable;
  id: string;
}

const STORAGE_KEY = 'xbar-cloud-deletions';
const TABLES: ReadonlySet<string> = new Set<CloudDeletionTable>([
  'horses',
  'sales_leads',
  'expense_receipts',
  'ranch_assets',
]);

let memory: CloudDeletion[] | null = null;

function isCloudDeletion(value: unknown): value is CloudDeletion {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.table === 'string' && TABLES.has(entry.table) && typeof entry.id === 'string' && entry.id !== '';
}

function sameEntry(a: CloudDeletion, b: CloudDeletion) {
  return a.table === b.table && a.id === b.id;
}

function read(): CloudDeletion[] {
  if (memory) return memory;
  const raw = readBrowserStorage(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCloudDeletion) : [];
  } catch {
    return [];
  }
}

function write(entries: CloudDeletion[]) {
  memory = entries;
  writeBrowserStorage(STORAGE_KEY, JSON.stringify(entries));
}

/** Deletions this device has made and the cloud has not yet applied. */
export function pendingCloudDeletions(): CloudDeletion[] {
  return read().slice();
}

/** Queue records a person deleted. Duplicates and malformed entries are dropped. */
export function queueCloudDeletions(entries: CloudDeletion[]): void {
  const next = read().slice();
  for (const entry of entries) {
    if (isCloudDeletion(entry) && !next.some((queued) => sameEntry(queued, entry))) {
      next.push({ table: entry.table, id: entry.id });
    }
  }
  write(next);
}

/**
 * Remove the entries a save has applied -- only those. A record deleted while
 * that save was in flight was not in it, and stays queued for the next one.
 */
export function acknowledgeCloudDeletions(applied: CloudDeletion[]): void {
  if (!applied.length) return;
  write(read().filter((queued) => !applied.some((done) => sameEntry(done, queued))));
}

/**
 * Forget every queued deletion. For the points where the local record set is
 * replaced wholesale -- a cloud pull, a restored backup, a reset -- after which
 * the queued ids describe records that are no longer this device's to delete.
 */
export function clearCloudDeletions(): void {
  write([]);
}

/** The ids queued for one table, for the save that applies them. */
export function cloudDeletionIds(deletions: readonly CloudDeletion[], table: CloudDeletionTable): string[] {
  return deletions.filter((entry) => entry.table === table).map((entry) => entry.id);
}

/*
 * Which cloud rows a save may remove.
 *
 * `listed`: exactly the ids a person deleted on this device. A row the device
 * merely does not have is left alone -- it was added by another device, or
 * written server-side, after this one loaded. Every ordinary save.
 *
 * `absent`: every row the device does not have. Only for Settings > Push cloud,
 * where a person has chosen "make the cloud match this device".
 */
export type RowRemoval = { mode: 'listed'; ids: readonly string[] } | { mode: 'absent' };

/**
 * The ids to delete from one table.
 *
 * `writing` is the ids this save is about to upsert; `existing` the ids the
 * cloud holds, which only an `absent` removal reads. A listed id that is also
 * being written was re-created after it was deleted, and the row being saved
 * wins.
 */
export function idsToRemove(
  removal: RowRemoval,
  writing: ReadonlySet<string>,
  existing: readonly string[] = [],
): string[] {
  const candidates = removal.mode === 'absent' ? existing : removal.ids;
  return [...new Set(candidates)].filter((id) => id && !writing.has(id));
}

/** Test seam: drop the memory copy so the next read goes back to storage. */
export function __resetCloudDeletionMemory(): void {
  memory = null;
}

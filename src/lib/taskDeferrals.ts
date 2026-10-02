/*
 * Hiding and snoozing Care Tasks (audit F09).
 *
 * Every task on the Care Tasks screen is derived from a record -- a care signal,
 * a document waiting for review, a buyer follow-up. It is completed by fixing
 * that record, and then it clears for everyone. The screen used to offer
 * "Mark Done", which only hid the row on this device for the UTC day and still
 * reported `task.completed`, and "Snooze", which showed a toast and stored
 * nothing.
 *
 * What it offers now is what it does: hide a task until a chosen local day, on
 * this device. A deferral is stored as the first local day the task shows again,
 * so it survives reloads and lapses on its own. Nothing here marks work done.
 */

export const TASK_DEFERRALS_KEY = 'xbar-task-deferrals';
/** The old per-UTC-day "done" keys; cleared once, never read. */
export const LEGACY_DISMISS_PREFIX = 'xbar-care-dismissed-';

/** task id -> first local day (YYYY-MM-DD) the task shows again. */
export type TaskDeferrals = Record<string, string>;

export const SNOOZE_CHOICES = [
  { days: 1, label: 'Tomorrow' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
] as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `today` plus `days`, on the local calendar. */
export function addLocalDays(today: string, days: number): string {
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(year!, month! - 1, day! + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Read stored deferrals, keeping only well-formed ones still in force. Anything
 * unreadable is dropped: a corrupt entry must never hide work indefinitely.
 */
export function readDeferrals(raw: string | null, today: string): TaskDeferrals {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const live: TaskDeferrals = {};
  for (const [id, until] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof until === 'string' && ISO_DAY.test(until) && until > today) live[id] = until;
  }
  return live;
}

export function deferTask(deferrals: TaskDeferrals, id: string, until: string): TaskDeferrals {
  return { ...deferrals, [id]: until };
}

export function isDeferred(deferrals: TaskDeferrals, id: string, today: string): boolean {
  const until = deferrals[id];
  return typeof until === 'string' && until > today;
}

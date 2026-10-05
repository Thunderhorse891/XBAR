import { addLocalCalendarDays, localIsoDate } from './format.js';
import { sha256 } from './sha256.js';

export type TaskDeferral = { revision: string; until: string };
export type TaskDeferrals = Record<string, TaskDeferral>;
export type DeferrableTask = { id: string; revision: string };
export const SNOOZE_CHOICES = [
  { days: 1, label: 'Tomorrow' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
] as const;

export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localIsoDate(date) === value;
}

export function addTaskDays(today: string, days: number): string {
  if (!isCalendarDay(today) || !Number.isInteger(days)) throw new Error('A valid calendar day is required.');
  return localIsoDate(addLocalCalendarDays(new Date(`${today}T12:00:00`), days));
}

/** Scope is this browser plus exact member/workspace; no names or task details are stored in keys. */
export function taskDeferralsKey(workspaceId: string, userId: string, localWorkspaceCreatedAt: string): string {
  return `xbar-task-deferrals-v2:${sha256(JSON.stringify([workspaceId, userId, workspaceId || userId ? '' : localWorkspaceCreatedAt]))}`;
}

export function readTaskDeferrals(raw: string | null, today: string): TaskDeferrals {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([id, entry]) => {
        if (!/^(gap|care|doc|lead)-.+/.test(id) || !entry || typeof entry !== 'object') return false;
        const { until, revision } = entry;
        // A valid week-long snooze can be nine dates away after crossing time zones westward.
        return (
          typeof until === 'string' &&
          isCalendarDay(until) &&
          until > today &&
          until <= addTaskDays(today, 9) &&
          typeof revision === 'string' &&
          /^[a-f0-9]{64}$/.test(revision)
        );
      })
      .map(([id, entry]) => [id, { until: entry.until, revision: entry.revision }]),
  );
}

export function taskIsDeferred(deferrals: TaskDeferrals, task: DeferrableTask, today: string): boolean {
  const entry = deferrals[task.id];
  return Boolean(entry && entry.revision === task.revision && isCalendarDay(entry.until) && entry.until > today);
}

/** Independent task keys prevent unrelated tabs from clobbering each other's confirmed actions. */
export function taskDeferralEntryKey(scopeKey: string, taskId: string): string {
  return `${scopeKey}:${sha256(taskId)}`;
}

export function loadTaskDeferrals(
  storage: Pick<Storage, 'getItem'>,
  scopeKey: string,
  tasks: DeferrableTask[],
  today: string,
): TaskDeferrals {
  const deferrals: TaskDeferrals = {};
  for (const task of tasks) {
    const stored = readTaskDeferrals(storage.getItem(taskDeferralEntryKey(scopeKey, task.id)), today)[task.id];
    if (stored) deferrals[task.id] = stored;
  }
  return deferrals;
}

/** Same-task preferences are last-write-wins. No source record is marked complete. */
export function writeTaskDeferral(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  scopeKey: string,
  task: DeferrableTask,
  until: string,
  today: string,
): { ok: true; deferrals: TaskDeferrals } | { ok: false } {
  if (!isCalendarDay(until) || until <= today || until > addTaskDays(today, 7)) return { ok: false };
  try {
    const deferrals = { [task.id]: { revision: task.revision, until } };
    const key = taskDeferralEntryKey(scopeKey, task.id);
    const serialized = JSON.stringify(deferrals);
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) return { ok: false };
    return { ok: true, deferrals };
  } catch {
    return { ok: false };
  }
}

/** Report only confirmed restores if storage fails partway through this group. */
export function restoreTaskDeferrals(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  scopeKey: string,
  tasks: DeferrableTask[],
  today: string,
): { ok: boolean; restoredIds: string[] } {
  const restoredIds: string[] = [];
  try {
    for (const task of tasks) {
      const key = taskDeferralEntryKey(scopeKey, task.id);
      const stored = readTaskDeferrals(storage.getItem(key), today)[task.id];
      if (stored?.revision === task.revision) {
        storage.setItem(key, '{}');
        if (storage.getItem(key) !== '{}') return { ok: false, restoredIds };
      }
      restoredIds.push(task.id);
    }
    return { ok: true, restoredIds };
  } catch {
    return { ok: false, restoredIds };
  }
}

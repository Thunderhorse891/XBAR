import type { TimelineEvent } from '../types/xbar.js';
import { localIsoDate } from './format.js';

/** Calendar date recorded by the operator; reject normalized impossible dates. */
export function careDay(value: string | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value ?? '');
  if (!match || !Number.isFinite(Date.parse(value!))) return null;
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day ? day : null;
}

export function validateMedicalCompletion(
  date: string,
  state: TimelineEvent['completionState'],
  now = new Date(),
): string | null {
  const day = careDay(date);
  if (!day) return 'Enter a valid care date.';
  if (state !== undefined && state !== 'planned' && state !== 'completed') return 'Choose planned or completed care.';
  if (state === 'completed' && day > localIsoDate(now))
    return 'Future care cannot be completed. Choose Planned, or enter the actual completion date.';
  return null;
}

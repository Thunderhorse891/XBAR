import type { HorseRecord, TimelineEvent } from '../types/xbar.js';
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

/** Apply the same completed-care side effects on creation and confirmation. */
export function medicalCompletionUpdates(horse: HorseRecord, event: TimelineEvent): Partial<HorseRecord> {
  if (event.completionState !== 'completed') return {};
  if (event.status === 'Injury' || event.details?.recordType === 'injury') {
    return { status: 'Medical Review', medicalNotes: event.summary };
  }
  const day = careDay(event.date);
  const lastVisit = careDay(horse.lastVetVisit);
  if (event.status === 'Vet visit' && day && (!lastVisit || day >= lastVisit)) {
    return { lastVetVisit: event.date };
  }
  return {};
}

/** Reconcile a date supplied by changed/deleted completed evidence, preserving unrelated history. */
export function reconcileVetVisit(
  horse: HorseRecord,
  previousEvent: TimelineEvent,
  remainingTimeline: TimelineEvent[],
): Partial<HorseRecord> {
  const previousDay = careDay(previousEvent.date);
  if (
    previousEvent.status !== 'Vet visit' ||
    previousEvent.completionState !== 'completed' ||
    !previousDay ||
    careDay(horse.lastVetVisit) !== previousDay
  )
    return {};

  // No independent historical date can be reconstructed from a removed event.
  // Only explicit completed visits can supply the replacement, never planned care.
  const latest = remainingTimeline
    .filter((event) => event.status === 'Vet visit' && event.completionState === 'completed' && careDay(event.date))
    .reduce<TimelineEvent | undefined>(
      (best, event) => (!best || careDay(event.date)! > careDay(best.date)! ? event : best),
      undefined,
    );
  return { lastVetVisit: latest?.date ?? '' };
}

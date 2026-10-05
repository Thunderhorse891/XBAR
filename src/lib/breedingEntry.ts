import type { BreedingRecordDetails } from '../types/xbar.js';
import { localIsoDate } from './format.js';

/*
 * What a person says a breeding entry IS, chosen rather than inferred (audit
 * F07). A pregnancy check carries its result as a choice -- in foal, open, or
 * still awaiting -- and that choice decides the mare's status. The note beside
 * it is context, never the answer: reading the answer out of the note is how
 * "Negative -- mare is not pregnant" came to count as in foal.
 */
export const BREEDING_ENTRY_KINDS = [
  { value: 'breeding', label: 'Breeding (cover or AI)' },
  { value: 'pregnancy-check', label: 'Pregnancy check' },
  { value: 'foaling', label: 'Foaling' },
  { value: 'note', label: 'Other breeding note' },
] as const;

export const PREGNANCY_RESULTS = [
  { value: 'in-foal', label: 'In foal' },
  { value: 'open', label: 'Open (not in foal)' },
  { value: 'pending', label: 'Awaiting result' },
] as const;

export const FOALING_RESULTS = [
  { value: 'live', label: 'Live foal' },
  { value: 'loss', label: 'Foaling loss' },
  { value: 'unknown', label: 'Outcome not yet confirmed' },
] as const;

export type BreedingEntryKind = (typeof BREEDING_ENTRY_KINDS)[number]['value'];
export type PregnancyResult = (typeof PREGNANCY_RESULTS)[number]['value'];

export type BreedingEntryChoice = { kind?: string; result?: string };

export function breedingEntryDetails(
  choice: BreedingEntryChoice,
): { ok: true; details: BreedingRecordDetails } | { ok: false; message: string } {
  const kind = BREEDING_ENTRY_KINDS.find((option) => option.value === choice.kind)?.value;
  if (!kind) {
    return {
      ok: false,
      message: 'Choose what this entry records: a breeding, a pregnancy check, a foaling, or a note.',
    };
  }
  if (kind === 'foaling') {
    const result = FOALING_RESULTS.find((option) => option.value === choice.result)?.value;
    if (!result) return { ok: false, message: 'Choose the foaling outcome: live foal, loss, or unconfirmed.' };
    return { ok: true, details: { recordType: kind, result } };
  }
  if (kind !== 'pregnancy-check') return { ok: true, details: { recordType: kind } };

  const result = PREGNANCY_RESULTS.find((option) => option.value === choice.result)?.value;
  if (!result) {
    return { ok: false, message: 'Choose the check result: in foal, open, or awaiting result.' };
  }
  return { ok: true, details: { recordType: kind, result } };
}

export function breedingDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const date = new Date(value);
  const day = value.slice(0, 10);
  if (Number.isNaN(date.getTime()) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return new Date(`${day}T00:00:00Z`);
}

export function validateBreedingDate(value: string, kind: string | undefined, now = new Date()): string | null {
  const date = breedingDate(value);
  if (!date) return 'Enter a valid breeding record date.';
  if (kind !== 'note' && date.toISOString().slice(0, 10) > localIsoDate(now))
    return 'A recorded breeding, check, or foaling cannot be future-dated. Save plans as Other breeding note.';
  return null;
}

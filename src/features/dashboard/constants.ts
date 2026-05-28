import type { ExpenseCategory } from '@/types/xbar';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Feed',
  'Wormer',
  'Dental Float',
  'Farrier',
  'Vet Care',
  'Supplements',
  'Bedding',
  'Travel',
];

/**
 * Maps each care-signal status to the Pill tone used in the care board
 * section of the Dashboard route.
 */
export const CARE_SIGNAL_TONE: Record<'due' | 'watch' | 'clear', 'rose' | 'amber' | 'emerald'> = {
  due: 'rose',
  watch: 'amber',
  clear: 'emerald',
};

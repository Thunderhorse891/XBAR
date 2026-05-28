import type { ExpenseCategory } from '@/types/xbar';

/**
 * Extends ExpenseCategory with the sentinel value 'All' used by the
 * category filter UI in the Expenses route.
 */
export type ExpenseFilter = ExpenseCategory | 'All';

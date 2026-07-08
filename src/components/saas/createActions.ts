// Quick-create flow registry. Every key here must map to a flow in
// GlobalCreateDrawer that persists real data (or performs an honest
// navigation) — no toast-only placeholders.
export type CreateKey =
  | 'Add Horse'
  | 'Upload Document'
  | 'Add Health Record'
  | 'Add Breeding Record'
  | 'Move Horse'
  | 'Prepare Sale Packet'
  | 'Add Buyer Follow-up'
  | 'Add Expense'
  | 'Add Equipment';

export const createActions: CreateKey[] = [
  'Add Horse',
  'Upload Document',
  'Add Health Record',
  'Add Breeding Record',
  'Move Horse',
  'Prepare Sale Packet',
  'Add Buyer Follow-up',
  'Add Expense',
  'Add Equipment',
];

export type CreatePrefill = Record<string, string>;

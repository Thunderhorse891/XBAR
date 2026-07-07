/**
 * Discriminated union that tracks which entity type the right-click
 * context menu in the Dashboard route is currently targeting, together
 * with the pointer coordinates used to position the menu.
 */
export type DashboardMenuState =
  | { type: 'horse'; id: string; x: number; y: number }
  | { type: 'record'; id: string; x: number; y: number }
  | { type: 'lead'; id: string; x: number; y: number }
  | { type: 'expense'; id: string; x: number; y: number };

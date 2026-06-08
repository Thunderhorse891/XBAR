export const surfaceModes = ['collapsed', 'expanded', 'detailed', 'focus'] as const;

export type SurfaceMode = (typeof surfaceModes)[number];
export type SurfaceEvent = 'collapse' | 'expand' | 'detail' | 'focus' | 'toggle';

export type DrawerFact = {
  label: string;
  value: string;
};

export type DrawerAction = {
  label: string;
  path: string;
};

export type DrawerPayload = {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
  facts?: DrawerFact[];
  actions?: DrawerAction[];
};

export function isSurfaceMode(value: unknown): value is SurfaceMode {
  return typeof value === 'string' && surfaceModes.includes(value as SurfaceMode);
}

export function transitionSurfaceMode(current: SurfaceMode, event: SurfaceEvent): SurfaceMode {
  if (event === 'collapse') return 'collapsed';
  if (event === 'expand') return 'expanded';
  if (event === 'detail') return 'detailed';
  if (event === 'focus') return 'focus';
  return current === 'collapsed' ? 'expanded' : 'collapsed';
}

export function sanitizeSurfaceModes(value: unknown): Record<string, SurfaceMode> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, SurfaceMode] => isSurfaceMode(entry[1])),
  );
}

export function interactionHint(hasActions = false) {
  return `Press Enter to open${hasActions ? '. Press Shift+F10 for actions' : ''}.`;
}

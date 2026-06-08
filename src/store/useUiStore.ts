import { create } from 'zustand';
import { createId } from '@/lib/xbarRuntime';
import {
  sanitizeSurfaceModes,
  transitionSurfaceMode,
  type DrawerPayload,
  type SurfaceEvent,
  type SurfaceMode,
} from '@/lib/interactionState';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export type ToastItem = {
  id: string;
  title?: string;
  message: string;
  tone: ToastTone;
  duration: number;
};

type UiStore = {
  toasts: ToastItem[];
  surfaceModes: Record<string, SurfaceMode>;
  focusedSurfaceId: string | null;
  rightDrawer: DrawerPayload | null;
  commandPaletteOpen: boolean;
  pushToast: (toast: { id?: string; title?: string; message: string; tone?: ToastTone; duration?: number }) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
  sendSurfaceEvent: (id: string, event: SurfaceEvent) => void;
  exitFocusMode: () => void;
  openRightDrawer: (drawer: DrawerPayload) => void;
  closeRightDrawer: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
};

const surfaceMemoryKey = 'xbar-ui-surface-modes-v1';

function readSurfaceModes() {
  if (typeof window === 'undefined') return {};
  try {
    return sanitizeSurfaceModes(JSON.parse(window.localStorage.getItem(surfaceMemoryKey) ?? '{}'));
  } catch {
    return {};
  }
}

function rememberSurfaceModes(modes: Record<string, SurfaceMode>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(surfaceMemoryKey, JSON.stringify(modes));
}

function createToastId() {
  return createId('toast');
}

export const useUiStore = create<UiStore>((set) => ({
  toasts: [],
  surfaceModes: readSurfaceModes(),
  focusedSurfaceId: null,
  rightDrawer: null,
  commandPaletteOpen: false,
  pushToast: ({ id, duration = 4000, tone = 'info', ...toast }) => {
    const toastId = id ?? createToastId();
    set((state) => ({
      toasts: [...state.toasts, { id: toastId, duration, tone, ...toast }],
    }));
    return toastId;
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
  clearToasts: () => set({ toasts: [] }),
  sendSurfaceEvent: (id, event) => set((state) => {
    const nextMode = transitionSurfaceMode(state.surfaceModes[id] ?? 'expanded', event);
    const surfaceModes = { ...state.surfaceModes, [id]: nextMode };
    rememberSurfaceModes(surfaceModes);
    return {
      surfaceModes,
      focusedSurfaceId: nextMode === 'focus' ? id : state.focusedSurfaceId === id ? null : state.focusedSurfaceId,
    };
  }),
  exitFocusMode: () => set((state) => {
    if (!state.focusedSurfaceId) return state;
    const surfaceModes = { ...state.surfaceModes, [state.focusedSurfaceId]: 'expanded' as const };
    rememberSurfaceModes(surfaceModes);
    return { surfaceModes, focusedSurfaceId: null };
  }),
  openRightDrawer: (rightDrawer) => set({ rightDrawer }),
  closeRightDrawer: () => set({ rightDrawer: null }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
}));

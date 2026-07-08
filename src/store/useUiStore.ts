import { create } from 'zustand';
import { toast as sonnerToast } from 'sonner';
import { createId } from '@/lib/xbarRuntime';
import type { CreateKey, CreatePrefill } from '@/components/saas/createActions';
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
  createAction: CreateKey | null;
  createPrefill: CreatePrefill;
  openCreate: (action: CreateKey, prefill?: CreatePrefill) => void;
  closeCreate: () => void;
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
  createAction: null,
  createPrefill: {},
  openCreate: (createAction, createPrefill = {}) => set({ createAction, createPrefill }),
  closeCreate: () => set({ createAction: null, createPrefill: {} }),
  pushToast: ({ id, duration = 4000, tone = 'info', ...toast }) => {
    const toastId = id ?? createToastId();
    const options = { id: toastId, description: toast.title ? toast.message : undefined, duration };
    const message = toast.title ?? toast.message;
    if (tone === 'success') sonnerToast.success(message, options);
    else if (tone === 'error') sonnerToast.error(message, options);
    else if (tone === 'warning') sonnerToast.warning(message, options);
    else sonnerToast.info(message, options);
    return toastId;
  },
  removeToast: (id) => {
    sonnerToast.dismiss(id);
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },
  clearToasts: () => {
    sonnerToast.dismiss();
    set({ toasts: [] });
  },
  sendSurfaceEvent: (id, event) =>
    set((state) => {
      const nextMode = transitionSurfaceMode(state.surfaceModes[id] ?? 'expanded', event);
      const surfaceModes = { ...state.surfaceModes, [id]: nextMode };
      rememberSurfaceModes(surfaceModes);
      return {
        surfaceModes,
        focusedSurfaceId: nextMode === 'focus' ? id : state.focusedSurfaceId === id ? null : state.focusedSurfaceId,
      };
    }),
  exitFocusMode: () =>
    set((state) => {
      if (!state.focusedSurfaceId) return state;
      const surfaceModes = { ...state.surfaceModes, [state.focusedSurfaceId]: 'expanded' as const };
      rememberSurfaceModes(surfaceModes);
      return { surfaceModes, focusedSurfaceId: null };
    }),
  openRightDrawer: (rightDrawer) => set({ rightDrawer }),
  closeRightDrawer: () => set({ rightDrawer: null }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
}));

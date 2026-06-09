import { create } from 'zustand';
import { createId } from '@/lib/xbarRuntime';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export type ToastItem = {
  id: string;
  title?: string;
  message: string;
  tone: ToastTone;
  duration: number;
};

export type DrawerContent =
  | { type: 'horse-health'; horseId: string }
  | { type: 'horse-breeding'; horseId: string }
  | { type: 'horse-documents'; horseId: string }
  | { type: 'horse-financial'; horseId: string }
  | { type: 'horse-detail'; horseId: string }
  | { type: 'document-preview'; documentId: string }
  | { type: 'notification-centre' }
  | { type: 'keyboard-shortcuts' };

type DrawerState = {
  isOpen: boolean;
  content: DrawerContent | null;
  stack: DrawerContent[];
  triggerElementId: string | null;
};

type UiStore = {
  toasts: ToastItem[];
  pushToast: (toast: { id?: string; title?: string; message: string; tone?: ToastTone; duration?: number }) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;

  drawer: DrawerState;
  openDrawer: (content: DrawerContent, triggerElementId?: string) => void;
  pushDrawer: (content: DrawerContent) => void;
  closeDrawer: () => void;
  closeAllDrawers: () => void;

  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;

  focusedCardId: string | null;
  setFocusedCard: (id: string | null) => void;
};

function createToastId() {
  return createId('toast');
}

export const useUiStore = create<UiStore>((set, get) => ({
  // ── Toasts ──────────────────────────────────────────────────────────
  toasts: [],
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

  // ── Drawer ──────────────────────────────────────────────────────────
  drawer: {
    isOpen: false,
    content: null,
    stack: [],
    triggerElementId: null,
  },

  openDrawer: (content, triggerElementId) => {
    set({
      drawer: {
        isOpen: true,
        content,
        stack: [],
        triggerElementId: triggerElementId ?? null,
      },
    });
  },

  pushDrawer: (content) => {
    const { drawer } = get();
    if (!drawer.isOpen || !drawer.content) {
      set({ drawer: { isOpen: true, content, stack: [], triggerElementId: null } });
      return;
    }
    if (drawer.stack.length >= 1) return; // max depth 2
    set({
      drawer: {
        ...drawer,
        stack: [...drawer.stack, drawer.content],
        content,
      },
    });
  },

  closeDrawer: () => {
    const { drawer } = get();
    if (drawer.stack.length > 0) {
      const stack = [...drawer.stack];
      const content = stack.pop()!;
      set({ drawer: { ...drawer, content, stack } });
    } else {
      const triggerId = drawer.triggerElementId;
      set({ drawer: { isOpen: false, content: null, stack: [], triggerElementId: null } });
      if (triggerId) {
        requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
      }
    }
  },

  closeAllDrawers: () => {
    const { drawer } = get();
    const triggerId = drawer.triggerElementId;
    set({ drawer: { isOpen: false, content: null, stack: [], triggerElementId: null } });
    if (triggerId) {
      requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
    }
  },

  // ── Command Palette ──────────────────────────────────────────────────
  commandPaletteOpen: false,
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),

  // ── Focused Card ─────────────────────────────────────────────────────
  focusedCardId: null,
  setFocusedCard: (id) => set({ focusedCardId: id }),
}));

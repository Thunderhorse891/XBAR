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

type UiStore = {
  toasts: ToastItem[];
  pushToast: (toast: { id?: string; title?: string; message: string; tone?: ToastTone; duration?: number }) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
};

function createToastId() {
  return createId('toast');
}

export const useUiStore = create<UiStore>((set) => ({
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
}));

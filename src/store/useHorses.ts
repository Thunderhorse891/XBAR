import { create } from 'zustand';
import { OCRHorse } from '@/types/horse';

type HorseStore = {
  horses: OCRHorse[];
  selectedHorseIds: string[];
  setHorses: (data: OCRHorse[]) => void;
  updateHorse: (id: string, updates: Partial<OCRHorse>) => void;
  selectHorse: (id: string) => void;
  deselectHorse: (id: string) => void;
  clearSelection: () => void;
};

export const useHorses = create<HorseStore>((set) => ({
  horses: [],
  selectedHorseIds: [],
  setHorses: (data) => set({ horses: data }),
  updateHorse: (id, updates) =>
    set((state) => ({
      horses: state.horses.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    })),
  selectHorse: (id) =>
    set((state) => ({
      selectedHorseIds: [...state.selectedHorseIds, id],
    })),
  deselectHorse: (id) =>
    set((state) => ({
      selectedHorseIds: state.selectedHorseIds.filter((hid) => hid !== id),
    })),
  clearSelection: () => set({ selectedHorseIds: [] }),
}));

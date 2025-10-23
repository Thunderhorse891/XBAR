
import { create } from 'zustand';
import { Horse } from '../types/horse';

interface HorseState {
  horses: Horse[];
  setHorses: (data: Horse[]) => void;
  updateHorse: (id: string, updated: Partial<Horse>) => void;
}

export const useHorses = create<HorseState>((set) => ({
  horses: [],
  setHorses: (data) => set({ horses: data }),
  updateHorse: (id, updated) =>
    set((state) => ({
      horses: state.horses.map((h) => (h.id === id ? { ...h, ...updated } : h)),
    })),
}));

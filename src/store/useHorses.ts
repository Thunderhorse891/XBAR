import { create } from 'zustand';
import { OCRHorse } from '@/types/horse';

type HorseStore = {
  horses: OCRHorse[];
  selectedHorseIds: string[];
  setHorses: (data: OCRHorse[]) => void;
  updateHorse: (id: string, updates: Partial<OCRHorse>) => void;
  addHorse: (horse: OCRHorse) => void;
  selectHorse: (id: string) => void;
  deselectHorse: (id: string) => void;
  clearSelection: () => void;
};

export const useHorses = create<HorseStore>((set) => ({
  horses: [
    { id: '1', name: 'WIGGY N RED', breed: 'Quarter Horse', age: 8, color: 'Sorrel', owner: 'Erin Wyrick', status: 'Active', registered: true, medicalNotes: 'Regular checkups only.', lastVetVisit: '2025-02-10', gender: 'Female' },
    { id: '2', name: 'HANCOCK SILVER POCO', breed: 'Appaloosa', age: 11, color: 'Gray', owner: 'Jason', status: 'Active', registered: true, medicalNotes: 'Arthritis management, monthly supplements.', lastVetVisit: '2025-01-28', gender: 'Gelding' },
    { id: '3', name: 'BONNY LIL MAN ROGERS', breed: 'Paint', age: 6, color: 'Bay', owner: 'Erin Wyrick', status: 'Active', registered: true, medicalNotes: 'Requires follow-up mobility review.', lastVetVisit: '2025-03-01', gender: 'Male' },
    { id: '4', name: 'RT BLUE DOLLY 1321', breed: 'Quarter Horse', age: 9, color: 'Roan', owner: 'Jason', status: 'For Sale', registered: false, medicalNotes: 'Healthy, no issues.', lastVetVisit: '2024-12-15', gender: 'Female' },
    { id: '5', name: 'THUNDER', breed: 'Thoroughbred', age: 7, color: 'Bay', owner: 'Erin Wyrick', status: 'Active', registered: true, medicalNotes: 'Regular checkups.', lastVetVisit: '2025-01-15', gender: 'Male' },
    { id: '6', name: 'SHADOW', breed: 'Arabian', age: 14, color: 'Black', owner: 'Jason', status: 'Retired', registered: true, medicalNotes: 'Retirement pasture, light exercise only.', lastVetVisit: '2024-11-20', gender: 'Male' },
  ],
  selectedHorseIds: [],
  setHorses: (data) => set({ horses: data }),
  addHorse: (horse) => set((state) => ({ horses: [...state.horses, horse] })),
  updateHorse: (id, updates) =>
    set((state) => ({
      horses: state.horses.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    })),
  selectHorse: (id) =>
    set((state) => ({ selectedHorseIds: [...state.selectedHorseIds, id] })),
  deselectHorse: (id) =>
    set((state) => ({ selectedHorseIds: state.selectedHorseIds.filter((hid) => hid !== id) })),
  clearSelection: () => set({ selectedHorseIds: [] }),
}));


import { create } from "zustand"
import { Horse } from "@/types/horse"

type State = {
  horses: Horse[]
  selectedIds: string[]
  setHorses: (h: Horse[]) => void
  toggleSelect: (id: string) => void
  updateHorse: (id: string, updates: Partial<Horse>) => void
}

export const useHorses = create<State>((set) => ({
  horses: [],
  selectedIds: [],
  setHorses: (horses) => set({ horses }),
  toggleSelect: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((i) => i !== id)
        : [...state.selectedIds, id]
    })),
  updateHorse: (id, updates) =>
    set((state) => ({
      horses: state.horses.map((h) =>
        h.id === id ? { ...h, ...updates } : h
      )
    }))
}))

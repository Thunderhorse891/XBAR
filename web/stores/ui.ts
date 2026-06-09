import { create } from 'zustand';

interface UiState {
  sidebarOpen: boolean;
  salePacketOpen: boolean;
  salePacketHorseId: string | null;
  addHorseOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  openSalePacket: (horseId?: string | null) => void;
  closeSalePacket: () => void;
  setAddHorseOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  salePacketOpen: false,
  salePacketHorseId: null,
  addHorseOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  openSalePacket: (horseId = null) => set({ salePacketOpen: true, salePacketHorseId: horseId }),
  closeSalePacket: () => set({ salePacketOpen: false, salePacketHorseId: null }),
  setAddHorseOpen: (open) => set({ addHorseOpen: open }),
}));

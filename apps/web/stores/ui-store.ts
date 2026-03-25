import { create } from 'zustand';

interface UIState {
  selectedSessionId: string | null;
  sidebarWidth: number;

  setSelectedSessionId: (id: string | null) => void;
  setSidebarWidth: (width: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedSessionId: null,
  sidebarWidth: 240,

  setSelectedSessionId: (id) => set({ selectedSessionId: id }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
}));

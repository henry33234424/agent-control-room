import { create } from 'zustand';

interface SelectionState {
  selectedMessageIds: Set<string>;
  toggle: (id: string) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedMessageIds: new Set<string>(),
  toggle: (id) =>
    set((state) => {
      const next = new Set(state.selectedMessageIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedMessageIds: next };
    }),
  clear: () => set({ selectedMessageIds: new Set<string>() }),
}));

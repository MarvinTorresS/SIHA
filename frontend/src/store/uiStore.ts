import { create } from "zustand"

/**
 * Estado global de UI que no pertenece a ningún dominio de negocio
 * (auth, horarios, etc.) — por ahora solo controla el drawer del
 * sidebar en mobile.
 */
interface UiState {
  isMobileSidebarOpen: boolean
  openMobileSidebar: () => void
  closeMobileSidebar: () => void
  toggleMobileSidebar: () => void
}

export const useUiStore = create<UiState>((set) => ({
  isMobileSidebarOpen: false,
  openMobileSidebar: () => set({ isMobileSidebarOpen: true }),
  closeMobileSidebar: () => set({ isMobileSidebarOpen: false }),
  toggleMobileSidebar: () =>
    set((state) => ({ isMobileSidebarOpen: !state.isMobileSidebarOpen })),
}))

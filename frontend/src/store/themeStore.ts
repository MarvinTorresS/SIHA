import { create } from "zustand"
import { persist } from "zustand/middleware"

export type Theme = "light" | "dark"

interface ThemeState {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

/**
 * Persistido en localStorage (key "siha-theme") para que el tema elegido
 * sobreviva un refresh. La clase "dark" en <html> se aplica desde un
 * efecto en AppShell, no acá -- este store solo guarda la preferencia.
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "light",
      toggleTheme: () =>
        set((state) => ({ theme: state.theme === "light" ? "dark" : "light" })),
      setTheme: (theme) => set({ theme }),
    }),
    { name: "siha-theme" }
  )
)

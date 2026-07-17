import { create } from "zustand"
import type { CarreraSigla } from "@/types/academico"

/**
 * Carrera seleccionada para explorar la malla curricular. Vive en Zustand
 * (no local a MallaPage) para poder reutilizarse en Sprint 7 (ej. filtrar
 * Mi Horario u otras pantallas por la misma selección).
 */
interface CarreraState {
  carreraSeleccionada: CarreraSigla
  setCarreraSeleccionada: (carrera: CarreraSigla) => void
}

export const useCarreraStore = create<CarreraState>((set) => ({
  carreraSeleccionada: "isi",
  setCarreraSeleccionada: (carrera) => set({ carreraSeleccionada: carrera }),
}))

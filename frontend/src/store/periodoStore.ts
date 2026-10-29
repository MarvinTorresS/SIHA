import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"

/**
 * localStorage envuelto en try/catch: en modo privado, con storage
 * bloqueado o lleno, getItem/setItem pueden lanzar. Recordar el ciclo es
 * solo una comodidad -- si falla, se usa el período predeterminado.
 */
const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      // sin persistencia, la selección vive solo en memoria
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      // idem
    }
  },
}

interface PeriodoState {
  /** Código elegido por el estudiante; null = usar el predeterminado.
   * Puede quedar obsoleto si el período deja de estar activo -- por eso
   * nunca se lee directo: ver usePeriodoSeleccionado. */
  codigoElegido: string | null
  setCodigoElegido: (codigo: string) => void
}

/** Ciclo seleccionado, compartido entre Mis Cursos y Mi Horario. */
export const usePeriodoStore = create<PeriodoState>()(
  persist(
    (set) => ({
      codigoElegido: null,
      setCodigoElegido: (codigo) => set({ codigoElegido: codigo }),
    }),
    { name: "siha-periodo", storage: createJSONStorage(() => safeLocalStorage) }
  )
)

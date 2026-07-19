import { create } from "zustand"
import type { Estudiante } from "@/types/academico"
import type { LoginRequest, RegistroRequest } from "@/types/auth"
import { authService } from "@/services/auth.service"
import { TOKEN_STORAGE_KEY } from "@/services/api"
import { useCarreraStore } from "@/store/carreraStore"

interface AuthState {
  estudiante: Estudiante | null
  isAuthenticated: boolean
  /** true mientras se intenta hidratar la sesión desde el token guardado al arrancar la app. */
  isHydrating: boolean
  login: (datos: LoginRequest) => Promise<void>
  registrar: (datos: RegistroRequest) => Promise<void>
  logout: () => void
  /** Intenta restaurar la sesión desde localStorage -- se llama una vez al montar RequireAuth. */
  hidratar: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  estudiante: null,
  isAuthenticated: false,
  isHydrating: true,

  login: async (datos) => {
    const sesion = await authService.login(datos)
    localStorage.setItem(TOKEN_STORAGE_KEY, sesion.token)
    set({ estudiante: sesion.estudiante, isAuthenticated: true })
    useCarreraStore.getState().setCarreraSeleccionada(sesion.estudiante.carrera.sigla)
  },

  registrar: async (datos) => {
    const sesion = await authService.registrar(datos)
    localStorage.setItem(TOKEN_STORAGE_KEY, sesion.token)
    set({ estudiante: sesion.estudiante, isAuthenticated: true })
    useCarreraStore.getState().setCarreraSeleccionada(sesion.estudiante.carrera.sigla)
  },

  logout: () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    set({ estudiante: null, isAuthenticated: false })
  },

  hidratar: async () => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) {
      set({ isHydrating: false })
      return
    }
    try {
      const { estudiante } = await authService.me()
      set({ estudiante, isAuthenticated: true, isHydrating: false })
      useCarreraStore.getState().setCarreraSeleccionada(estudiante.carrera.sigla)
    } catch {
      // Token vencido/inválido -- se limpia para no reintentar en cada request.
      localStorage.removeItem(TOKEN_STORAGE_KEY)
      set({ estudiante: null, isAuthenticated: false, isHydrating: false })
    }
  },
}))

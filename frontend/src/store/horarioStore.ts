// store/horarioStore.ts
import { create } from "zustand"
import type { Seccion } from "@/types/seccion"
import type { ConflictoHorario } from "@/types/conflicto"
import { horariosService } from "@/services/horarios.service"

interface HorarioState {
  // --- Estado ---
  seccionesFijas: Map<string, Seccion>
  seccionesManuales: Seccion[]
  conflictos: ConflictoHorario[]
  isValidando: boolean
  errorValidacion: string | null

  // --- Acciones ---
  cargarSeccionesFijas: (nrcs: string[]) => Promise<void>
  agregarSeccionManual: (seccion: Seccion) => Promise<void>
  removerSeccionManual: (nrc: string) => Promise<void>
  reemplazarSeccionManual: (nrcAnterior: string, nuevaSeccion: Seccion) => Promise<void>
  validar: () => Promise<void>
  reset: () => void

  // --- Selectores ---
  todasLasSecciones: () => Seccion[]
  todosLosNrcs: () => string[]
  cursoYaAsignado: (codigoCurso: string) => boolean
  tieneConflictos: () => boolean
  conflictosDeNrc: (nrc: string) => ConflictoHorario[]
}

export const useHorarioStore = create<HorarioState>((set, get) => ({
  // --- Estado inicial ---
  seccionesFijas: new Map(),
  seccionesManuales: [],
  conflictos: [],
  isValidando: false,
  errorValidacion: null,

  // --- Acciones ---
  cargarSeccionesFijas: async (nrcs: string[]) => {
    const resultados = await Promise.allSettled(
      nrcs.map((nrc) => horariosService.obtenerPorNrc(nrc))
    )

    const secciones: Seccion[] = []
    resultados.forEach((r) => {
      if (r.status === "fulfilled") secciones.push(r.value)
    })

    const mapa = new Map<string, Seccion>()
    secciones.forEach((s) => mapa.set(s.codigoCurso, s))

    set({ seccionesFijas: mapa })

    // Validar siempre después de cargar, no solo si hay manuales
    await get().validar()
  },

  agregarSeccionManual: async (seccion: Seccion) => {
    const actuales = get().seccionesManuales
    if (actuales.some((s) => s.nrc === seccion.nrc)) return

    set({ seccionesManuales: [...actuales, seccion] })
    await get().validar()
  },

  removerSeccionManual: async (nrc: string) => {
    set({
      seccionesManuales: get().seccionesManuales.filter((s) => s.nrc !== nrc),
    })
    await get().validar()
  },

  reemplazarSeccionManual: async (nrcAnterior: string, nuevaSeccion: Seccion) => {
    set({
      seccionesManuales: get()
        .seccionesManuales
        .filter((s) => s.nrc !== nrcAnterior)
        .concat(nuevaSeccion),
    })
    await get().validar()
  },

  validar: async () => {
    const nrcs = get().todosLosNrcs()

    if (nrcs.length === 0) {
      set({ conflictos: [], isValidando: false, errorValidacion: null })
      return
    }

    set({ isValidando: true, errorValidacion: null })

    try {
      const response = await horariosService.validar(nrcs)
      set({
        conflictos: response.tieneConflictos ? response.conflictos : [],
        isValidando: false,
      })
    } catch (err) {
      set({
        conflictos: [],
        isValidando: false,
        errorValidacion:
          err instanceof Error ? err.message : "Error al validar horario",
      })
    }
  },

  reset: () =>
    set({
      seccionesFijas: new Map(),
      seccionesManuales: [],
      conflictos: [],
      isValidando: false,
      errorValidacion: null,
    }),

  // --- Selectores ---
  todasLasSecciones: () => {
    const { seccionesFijas, seccionesManuales } = get()
    return [...seccionesFijas.values(), ...seccionesManuales]
  },

  todosLosNrcs: () => {
    return get().todasLasSecciones().map((s) => s.nrc)
  },

  cursoYaAsignado: (codigoCurso: string) => {
    const { seccionesFijas, seccionesManuales } = get()
    return (
      seccionesFijas.has(codigoCurso) ||
      seccionesManuales.some((s) => s.codigoCurso === codigoCurso)
    )
  },

  tieneConflictos: () => get().conflictos.length > 0,

  conflictosDeNrc: (nrc: string) => {
    return get().conflictos.filter(
      (c) => c.seccionA.nrc === nrc || c.seccionB.nrc === nrc
    )
  },
}))
// store/horarioStore.ts
import { create } from "zustand"
import type { Seccion } from "@/types/seccion"
import type { ConflictoHorario } from "@/types/conflicto"
import { horariosService } from "@/services/horarios.service"

interface HorarioState {
  // --- Estado ---
  /** Período al que pertenecen las secciones de este store. Todo lo de
   * abajo (fijas, borrador, conflictos) es SOLO de este período: el NRC no
   * es único entre ciclos y un borrador no se arrastra de un ciclo a otro. */
  periodo: string | null
  /** Borradores de los OTROS períodos, guardados al cambiar de ciclo para
   * recuperarlos al volver (en memoria, no se persisten). */
  borradoresPorPeriodo: Record<string, Seccion[]>
  seccionesFijas: Map<string, Seccion>
  seccionesManuales: Seccion[]
  conflictos: ConflictoHorario[]
  isValidando: boolean
  errorValidacion: string | null

  // --- Acciones ---
  /** Cambia el período activo del store: guarda el borrador actual bajo
   * su período, carga el del nuevo (o vacío) y limpia fijas/conflictos. */
  setPeriodo: (periodo: string) => void
  cargarSeccionesFijas: (nrcs: string[]) => Promise<void>
  agregarSeccionManual: (seccion: Seccion) => Promise<void>
  removerSeccionManual: (nrc: string) => Promise<void>
  reemplazarSeccionManual: (nrcAnterior: string, nuevaSeccion: Seccion) => Promise<void>
  /** Vacía solo el borrador manual (no las fijas) -- se usa al confirmar
   * matrícula: esos cursos van a recargarse como fijos ("cursando") en
   * el próximo refetch de la oferta, no deben seguir contados como
   * manuales o se duplicarían en el calendario. */
  limpiarSeccionesManuales: () => void
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
  periodo: null,
  borradoresPorPeriodo: {},
  seccionesFijas: new Map(),
  seccionesManuales: [],
  conflictos: [],
  isValidando: false,
  errorValidacion: null,

  // --- Acciones ---
  setPeriodo: (periodo: string) => {
    const { periodo: actual, seccionesManuales, borradoresPorPeriodo } = get()
    if (actual === periodo) return

    const borradores = { ...borradoresPorPeriodo }
    if (actual !== null) borradores[actual] = seccionesManuales
    const recuperado = borradores[periodo] ?? []
    delete borradores[periodo]

    set({
      periodo,
      borradoresPorPeriodo: borradores,
      seccionesManuales: recuperado,
      seccionesFijas: new Map(),
      conflictos: [],
      isValidando: false,
      errorValidacion: null,
    })
    get().validar()
  },

  cargarSeccionesFijas: async (nrcs: string[]) => {
    const periodo = get().periodo
    if (periodo === null) return

    const resultados = await Promise.allSettled(
      nrcs.map((nrc) => horariosService.obtenerPorNrc(nrc, periodo))
    )
    // El estudiante cambió de ciclo mientras se resolvían: descartar.
    if (get().periodo !== periodo) return

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

  limpiarSeccionesManuales: () => {
    set({ seccionesManuales: [] })
    get().validar()
  },

  validar: async () => {
    const { periodo } = get()
    const nrcs = get().todosLosNrcs()

    if (periodo === null || nrcs.length === 0) {
      set({ conflictos: [], isValidando: false, errorValidacion: null })
      return
    }

    set({ isValidando: true, errorValidacion: null })

    try {
      const response = await horariosService.validar(nrcs, periodo)
      if (get().periodo !== periodo) return
      set({
        conflictos: response.tieneConflictos ? response.conflictos : [],
        isValidando: false,
      })
    } catch (err) {
      if (get().periodo !== periodo) return
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
      periodo: null,
      borradoresPorPeriodo: {},
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
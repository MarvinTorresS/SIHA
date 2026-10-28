import { api } from "./api"
import { periodoQuery } from "./periodos.service"
import type { Seccion } from "@/types/seccion"
import type {
  ValidarHorarioBody,
  ValidarHorarioResponse,
} from "@/types/conflicto"

export const horariosService = {
  /**
   * GET /api/horarios/secciones/{codigo} — lista las secciones
   * disponibles de un curso (para optativos/adelantos, donde el
   * estudiante elige manualmente). No filtra por compatibilidad; la
   * validación de choque ocurre al confirmar, vía validar().
   */
  listarSecciones(codigoCurso: string, periodo: string) {
    return api.get<Seccion[]>(`/horarios/secciones/${codigoCurso}${periodoQuery(periodo)}`)
  },

  /**
   * GET /api/horarios/nrc/{nrc} — obtiene una sección individual por
   * su NRC. Útil para resolver asignaciones institucionales donde solo
   * se conoce el NRC, sin saber a qué curso pertenece. El NRC no es
   * único entre períodos, por eso el período es obligatorio.
   */
  obtenerPorNrc(nrc: string, periodo: string) {
    return api.get<Seccion>(`/horarios/nrc/${nrc}${periodoQuery(periodo)}`)
  },

  /**
   * POST /api/horarios/validar — recibe una lista de NRCs (mezcla de
   * secciones institucionales + elegidas manualmente) y devuelve si
   * hay conflicto y qué bloques específicos chocan.
   */
  validar(nrcs: string[], periodo: string) {
    return api.post<ValidarHorarioResponse>(`/horarios/validar${periodoQuery(periodo)}`, {
      nrcs,
    } satisfies ValidarHorarioBody)
  },
}
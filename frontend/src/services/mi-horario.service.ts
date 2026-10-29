import { api } from "./api"
import { periodoQuery } from "./periodos.service"
import type { Seccion } from "@/types/seccion"
import type { PeriodoHorario } from "@/types/periodo"

export const miHorarioService = {
  /**
   * GET /api/estudiantes/{carnet}/periodos-horario -- ciclos activos más
   * los finalizados donde el estudiante todavía tiene cursos "cursando".
   */
  obtenerPeriodos(carnet: string) {
    return api.get<PeriodoHorario[]>(`/estudiantes/${carnet}/periodos-horario`)
  },

  /**
   * GET /api/estudiantes/{carnet}/secciones-cursando?periodo= -- secciones
   * confirmadas ("cursando") del estudiante en ese período, independiente
   * de la oferta (a diferencia de estudianteService.obtenerOferta).
   */
  obtenerSeccionesCursando(carnet: string, periodo: string) {
    return api.get<Seccion[]>(
      `/estudiantes/${carnet}/secciones-cursando${periodoQuery(periodo)}`
    )
  },
}

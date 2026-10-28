import { api } from "./api"
import { periodoQuery } from "./periodos.service"
import type { Seccion } from "@/types/seccion"

export const miHorarioService = {
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

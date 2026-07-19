import { api } from "./api"
import type { Seccion } from "@/types/seccion"

export const miHorarioService = {
  /**
   * GET /api/estudiantes/{carnet}/secciones-cursando -- secciones
   * confirmadas ("cursando") del estudiante, independiente de la oferta
   * del período activo (a diferencia de estudianteService.obtenerOferta).
   */
  obtenerSeccionesCursando(carnet: string) {
    return api.get<Seccion[]>(`/estudiantes/${carnet}/secciones-cursando`)
  },
}

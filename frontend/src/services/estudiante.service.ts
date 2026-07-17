import { api } from "./api"
import type { MallaProgresoResponse } from "@/types/estudiante"

export const estudianteService = {
  /** GET /api/estudiantes/{carnet}/malla-progreso */
  obtenerMallaProgreso(carnet: string) {
    return api.get<MallaProgresoResponse>(
      `/estudiantes/${carnet}/malla-progreso`
    )
  },
  /** POST /api/estudiantes/{carnet}/historial -- marca un curso como aprobado. */
  marcarAprobado(carnet: string, codigoCurso: string) {
    return api.post<void>(`/estudiantes/${carnet}/historial`, { codigoCurso })
  },
  /** DELETE /api/estudiantes/{carnet}/historial/{codigoCurso} -- deshace el aprobado. */
  desmarcarAprobado(carnet: string, codigoCurso: string) {
    return api.delete<void>(`/estudiantes/${carnet}/historial/${codigoCurso}`)
  },
}
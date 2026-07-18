import { api } from "./api"
import type { MallaProgresoResponse } from "@/types/estudiante"
import type { CursoOferta } from "@/types/oferta"

export const estudianteService = {
  /** GET /api/estudiantes/{carnet}/malla-progreso */
  obtenerMallaProgreso(carnet: string) {
    return api.get<MallaProgresoResponse>(
      `/estudiantes/${carnet}/malla-progreso`
    )
  },
  /**
   * GET /api/estudiantes/{carnet}/oferta -- oferta de cursos del período
   * activo para la carrera propia, con estado ya resuelto (aprobado /
   * cursando / elegible / bloqueado).
   */
  obtenerOferta(carnet: string) {
    return api.get<CursoOferta[]>(`/estudiantes/${carnet}/oferta`)
  },
  /** POST /api/estudiantes/{carnet}/historial -- marca un curso como aprobado. */
  marcarAprobado(carnet: string, codigoCurso: string) {
    return api.post<void>(`/estudiantes/${carnet}/historial`, { codigoCurso })
  },
  /** DELETE /api/estudiantes/{carnet}/historial/{codigoCurso} -- deshace el aprobado. */
  desmarcarAprobado(carnet: string, codigoCurso: string) {
    return api.delete<void>(`/estudiantes/${carnet}/historial/${codigoCurso}`)
  },
  /**
   * POST /api/estudiantes/{carnet}/matricula -- confirma el borrador de
   * Mis Cursos: cada NRC pasa su curso a "cursando" en el historial.
   */
  confirmarMatricula(carnet: string, nrcs: string[]) {
    return api.post<void>(`/estudiantes/${carnet}/matricula`, { nrcs })
  },
  /**
   * DELETE /api/estudiantes/{carnet}/historial/{codigoCurso} -- mismo
   * endpoint que desmarcarAprobado, nombrado distinto en el sitio de
   * llamada de Mis Cursos: acá se usa para dar de baja un curso
   * "cursando" ya confirmado (el backend generalizó desmarcarCurso para
   * aceptar ambos estados de origen).
   */
  quitarDelHistorial(carnet: string, codigoCurso: string) {
    return api.delete<void>(`/estudiantes/${carnet}/historial/${codigoCurso}`)
  },
}
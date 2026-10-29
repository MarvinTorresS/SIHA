import { api } from "./api"
import { periodoQuery } from "./periodos.service"
import type { MallaProgresoResponse } from "@/types/estudiante"
import type { CursoOferta } from "@/types/oferta"
import type { OpcionesSlotResponse, SeleccionCursoReal } from "@/types/mallaSlot"

export const estudianteService = {
  /** GET /api/estudiantes/{carnet}/malla-progreso */
  obtenerMallaProgreso(carnet: string) {
    return api.get<MallaProgresoResponse>(
      `/estudiantes/${carnet}/malla-progreso`
    )
  },
  /**
   * GET /api/estudiantes/{carnet}/oferta?periodo= -- oferta de cursos del
   * período para la carrera propia, con estado ya resuelto (aprobado /
   * cursando / elegible / bloqueado).
   */
  obtenerOferta(carnet: string, periodo: string) {
    return api.get<CursoOferta[]>(`/estudiantes/${carnet}/oferta${periodoQuery(periodo)}`)
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
  confirmarMatricula(carnet: string, nrcs: string[], periodo: string) {
    return api.post<void>(`/estudiantes/${carnet}/matricula${periodoQuery(periodo)}`, { nrcs })
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
  /**
   * GET /api/estudiantes/{carnet}/malla-slots/{slotCodigo}/opciones --
   * opciones de catálogo (Generales u Optativas) disponibles para llenar
   * ese slot, o el estado "tope_alcanzado".
   */
  obtenerOpcionesSlot(carnet: string, slotCodigo: string) {
    return api.get<OpcionesSlotResponse>(
      `/estudiantes/${carnet}/malla-slots/${slotCodigo}/opciones`
    )
  },
  /**
   * POST /api/estudiantes/{carnet}/malla-slots/{slotCodigo} -- asigna un
   * curso real (del catálogo o "Otro") a ese slot.
   */
  asignarCursoRealASlot(carnet: string, slotCodigo: string, seleccion: SeleccionCursoReal) {
    return api.post<void>(`/estudiantes/${carnet}/malla-slots/${slotCodigo}`, seleccion)
  },
  /**
   * DELETE /api/estudiantes/{carnet}/malla-slots/{slotCodigo} -- desasigna
   * el curso real de ese slot.
   */
  desasignarSlotMalla(carnet: string, slotCodigo: string) {
    return api.delete<void>(`/estudiantes/${carnet}/malla-slots/${slotCodigo}`)
  },
}
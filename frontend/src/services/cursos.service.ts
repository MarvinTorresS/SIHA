import { api } from "./api"
import type { Curso, CarreraParam } from "@/types/curso"

export const cursosService = {
  /** GET /api/cursos — con filtros opcionales idCarrera, cicloId */
  listar(params?: { idCarrera?: number; cicloId?: string }) {
    const query = new URLSearchParams()
    if (params?.idCarrera) query.set("idCarrera", String(params.idCarrera))
    if (params?.cicloId) query.set("cicloId", params.cicloId)
    const qs = query.toString()
    return api.get<Curso[]>(`/cursos${qs ? `?${qs}` : ""}`)
  },

  /** GET /api/cursos/{codigo} */
  obtenerPorCodigo(codigo: string) {
    return api.get<Curso>(`/cursos/${codigo}`)
  },

  /** GET /api/cursos/carrera/{id} */
  listarPorCarrera(idCarrera: number) {
    return api.get<Curso[]>(`/cursos/carrera/${idCarrera}`)
  },
}

// Re-exportado por conveniencia en componentes que solo necesitan el tipo
export type { Curso, CarreraParam }

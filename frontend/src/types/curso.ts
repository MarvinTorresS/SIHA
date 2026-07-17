import type { Carrera, CarreraSigla } from "./academico"

/**
 * Forma real de GET /api/cursos, GET /api/cursos/{codigo},
 * GET /api/cursos/carrera/{id}.
 *
 * Ojo: `creditos` viene como STRING desde la API (Prisma Decimal
 * serializado), no como number. Convertir con Number(curso.creditos)
 * donde se necesite operar matemáticamente.
 */
export interface Curso {
  id_curso: number
  codigo: string
  nombre: string
  creditos: string
  id_carrera: number
  es_general: boolean
  creditos_fuente: "banner" | "malla"
  creado_en: string
  actualizado_en: string
  ciclo_id: string
  ciclo_nombre: string
  es_optativo: boolean
  carrera: Carrera
}

export interface CursosQueryParams {
  idCarrera?: number
  cicloId?: string
}

/** Params de GET /api/cursos/carrera/{id} */
export interface CursosPorCarreraParams {
  idCarrera: number
}

/** Sigla de carrera aceptada en rutas que la usan como parámetro directo */
export type CarreraParam = CarreraSigla

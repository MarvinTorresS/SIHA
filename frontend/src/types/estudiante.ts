/**
 * Tipos para GET /api/estudiantes/{carnet}/malla-progreso.
 * Espejo del contrato real de estudiante.service.ts en la API —
 * ver ese archivo para la regla completa de "sin_seccion".
 */

import type { CarreraSigla } from "./academico"

export type EstadoCursoProgreso =
  | "aprobado"
  | "cursando"
  | "sin_seccion"
  | "pendiente"

export interface HorarioBloqueInfo {
  dia: string
  horaInicio: string
  horaFin: string
  aula: string
}

export interface SeccionInfo {
  nrc: string
  numeroSeccion: string
  profesor: string | null
  horarios: HorarioBloqueInfo[]
}

export interface CursoConProgreso {
  idCurso: number
  codigo: string
  nombre: string
  /** Decimal de Prisma serializado como string, ej. "3" */
  creditos: string
  cicloId: string
  cicloNombre: string
  esOptativo: boolean
  estado: EstadoCursoProgreso
  nota: string | null
  /** Solo presente en slots GEN{n}/OPT{n} con asignación explícita (ver Sheet "marcar aprobado con selector"). */
  cursoRealCodigo: string | null
  cursoRealNombre: string | null
  /** Solo presente si historial_curso.id_seccion no es null (típico en "cursando") */
  seccion: SeccionInfo | null
}

export interface SemestreProgreso {
  cicloId: string
  cicloNombre: string
  cursos: CursoConProgreso[]
}

export interface MallaProgresoResponse {
  estudiante: {
    carnet: string
    nombre: string
    cicloActualId: string
  }
  carrera: {
    idCarrera: number
    sigla: CarreraSigla
    nombre: string
  }
  resumen: {
    creditosTotalesCarrera: number
    creditosAprobados: number
    cursosTotales: number
    cursosAprobados: number
  }
  semestres: SemestreProgreso[]
}
import type { CarreraSigla } from "./academico"

/** Curso dentro de un ciclo de la malla — forma real de GET /api/mallas/:carrera */
export interface MallaCurso {
  code: string
  name: string
  credits: number
  isElective: boolean
}

export interface MallaCiclo {
  cycleId: string
  cycleName: string
  courses: MallaCurso[]
}

/** Respuesta completa de GET /api/mallas/{carrera} */
export interface MallaCarrera {
  programId: number
  programName: string
  programAcronym: CarreraSigla
  cycles: MallaCiclo[]
}

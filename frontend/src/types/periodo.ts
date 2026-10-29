/** Elemento de GET /api/periodos -- un período seleccionable en SIHA. */
export interface Periodo {
  codigo: string
  nombre: string
  /** El activo de código más bajo (el que está en curso). Exactamente uno. */
  esPredeterminado: boolean
}

/** Elemento de GET /api/estudiantes/{carnet}/periodos-horario (Mi Horario). */
export interface PeriodoHorario extends Periodo {
  /** Ciclo ya inactivo donde el estudiante tiene cursos "cursando": solo lectura. */
  finalizado: boolean
}

/** Período resumido que la API incluye dentro de otras respuestas. */
export interface PeriodoRef {
  codigo: string
  nombre: string
}

/** Forma real de un bloque dentro de horarios[] en GET /api/horarios/secciones/:codigo */
export interface BloqueHorario {
  dia: string
  horaInicio: string
  horaFin: string
  aula: string
}

/** Forma real de cada elemento de GET /api/horarios/secciones/{codigo} */
export interface Seccion {
  nrc: string
  codigoCurso: string
  titulo: string
  seccion: string
  creditos: number
  capacidad: number
  inscritos: number
  disponibles: number
  /** "activa" | "agotada" -- si Banner dejó de listar este NRC en la
   * última corrida del ETL, queda en "agotada" pero no se borra. */
  estadoOferta: string
  profesor: string
  horarios: BloqueHorario[]
}

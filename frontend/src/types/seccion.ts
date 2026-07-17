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
  profesor: string
  horarios: BloqueHorario[]
}

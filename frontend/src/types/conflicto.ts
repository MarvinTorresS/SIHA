export interface ValidarHorarioBody {
  nrcs: string[]
}

interface SeccionRefConflicto {
  codigoCurso: string
  nrc: string
}

/**
 * Bloque dentro de un conflicto — distinto de BloqueHorario (el de
 * secciones): este NO trae `aula`. Se tipa por separado para no
 * mentir sobre campos que la API no devuelve acá.
 */
interface BloqueConflicto {
  dia: string
  horaInicio: string
  horaFin: string
}

export interface ConflictoHorario {
  seccionA: SeccionRefConflicto
  seccionB: SeccionRefConflicto
  dia: string
  bloqueA: BloqueConflicto
  bloqueB: BloqueConflicto
}

/** Forma real de la respuesta de POST /api/horarios/validar */
export interface ValidarHorarioResponse {
  tieneConflictos: boolean
  conflictos: ConflictoHorario[]
}

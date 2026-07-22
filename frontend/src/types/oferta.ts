import type { BloqueHorario } from "./seccion"

export type EstadoOferta = "aprobado" | "cursando" | "elegible" | "bloqueado"

export interface SeccionOferta {
  nrc: string
  numeroSeccion: string
  profesor: string | null
  capacidad: number
  inscritos: number
  disponibles: number
  /** "activa" | "agotada" -- si Banner dejó de listar este NRC en la
   * última corrida del ETL, queda en "agotada" pero no se borra. */
  estadoOferta: string
  horarios: BloqueHorario[]
}

export interface PrerequisitoFaltante {
  code: string
  name: string
}

export interface CorequisitoOferta {
  code: string
  name: string
  credits: number
}

/**
 * Forma real de cada elemento de GET /api/estudiantes/{carnet}/oferta --
 * ver estudiante.service.ts (backend) para el detalle completo del cruce
 * Banner + historial + prerrequisitos.
 */
export interface CursoOferta {
  codigo: string
  nombre: string
  creditos: string
  cicloId: string
  cicloNombre: string
  estado: EstadoOferta
  /** Solo no-vacío cuando estado === "bloqueado". */
  prerrequisitosFaltantes: PrerequisitoFaltante[]
  /** Informativo siempre que existan -- no bloquea la elegibilidad. */
  corequisitos: CorequisitoOferta[]
  /** Solo presente cuando estado === "cursando". */
  seccionActual: SeccionOferta | null
  /** Secciones ofertadas por Banner este período para este curso. */
  secciones: SeccionOferta[]
}

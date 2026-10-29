import type { BloqueHorario } from "./seccion"
import type { PeriodoRef } from "./periodo"

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
  /** true si el estudiante lo tiene "cursando": no cuenta como aprobado,
   * debe marcarlo en la Malla cuando lo apruebe. */
  enCurso: boolean
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
  /** Curso de Estudios Generales (EGF/EGC/EGS/EGA) -- se usa para
   * bloquear en la UI la matrícula de un 5to general una vez el
   * estudiante ya tiene 4 aprobados/cursando. */
  esGeneral: boolean
  /** Electiva real del catálogo "Optativos" -- mismo uso que esGeneral,
   * pero contra maximoOptativas (tope dinámico por carrera). */
  esOptativa: boolean
  /** Tope de optativas de la carrera del estudiante (mismo valor en
   * todas las filas). */
  maximoOptativas: number
  /** Solo no-vacío cuando estado === "bloqueado" por prerrequisitos. */
  prerrequisitosFaltantes: PrerequisitoFaltante[]
  /** Razón de bloqueo cuando NO es por prerrequisitos (ej. tope de 4
   * Estudios Generales). null en cualquier otro caso. */
  motivoBloqueo: string | null
  /** Informativo siempre que existan -- no bloquea la elegibilidad. */
  corequisitos: CorequisitoOferta[]
  /** Solo presente cuando estado === "cursando". Puede ser una sección de
   * otro período (ver periodoCursando). */
  seccionActual: SeccionOferta | null
  /** Solo presente cuando estado === "cursando": el período en que está
   * matriculado, que puede no ser el seleccionado. */
  periodoCursando: PeriodoRef | null
  /** Secciones ofertadas por Banner este período para este curso. */
  secciones: SeccionOferta[]
}

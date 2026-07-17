/**
 * Tipos compartidos con la API de SIHA.
 * Definidos manualmente (sin workspace compartido) — ver decisión en
 * la planificación de Sprint 6. Basados en la forma REAL de las
 * respuestas verificadas contra la API en localhost:3000.
 *
 * Nota de convención: la API mezcla español (GET /cursos, GET
 * /horarios/secciones/:codigo) e inglés camelCase (GET /mallas/:carrera,
 * GET /prerrequisitos/:curso) según el endpoint. Se tipa cada uno tal
 * como viene realmente, sin forzar una convención que la API no tiene.
 */

export type CarreraSigla = "isi" | "itecad" | "topo" | "ingles" | "adm"

/**
 * Las 5 carreras del Campus Coto (config.py: CARRERAS_CAMPUS_COTO en
 * data-extractor). Nombre completo para UI (ej. selector de carrera).
 */
export const CARRERAS: { sigla: CarreraSigla; nombre: string }[] = [
  { sigla: "isi", nombre: "Ingeniería en Sistemas Informáticos" },
  { sigla: "ingles", nombre: "Enseñanza del Inglés" },
  { sigla: "topo", nombre: "Topografía y Catastro" },
  { sigla: "itecad", nombre: "Ciencia de Datos" },
  { sigla: "adm", nombre: "Administración" },
]

export interface Carrera {
  id_carrera: number
  sigla: CarreraSigla
  /** Nombre oficial completo, ej. "Ingeniería en Sistemas Informáticos" */
  nombre: string
  campus: string
}

/**
 * Estudiante autenticado -- espejo exacto de EstudianteAutenticado en
 * auth.service.ts (API). `carrera.nombre` ya es el nombre completo (mismo
 * valor que CARRERAS): no hay un campo "nombreCorto" separado, para no
 * duplicar esa lista en dos lugares.
 */
export interface Estudiante {
  carnet: string
  nombre: string
  correo: string
  /** ciclo_id de la malla (ej. "2 1"), o "" si el estudiante aún no lo tiene asignado. */
  cicloActualId: string
  carrera: {
    idCarrera: number
    sigla: CarreraSigla
    nombre: string
  }
}

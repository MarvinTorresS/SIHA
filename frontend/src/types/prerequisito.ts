export interface CorequisitoRef {
  code: string
  name: string
  credits: number
}

/**
 * Nodo del árbol de prerrequisitos — forma real de
 * GET /api/prerrequisitos/{curso}. Recursivo: cada curso requerido
 * puede tener a su vez sus propios `requires`.
 *
 * Nota: el motor es AND-simple (confirmado en Sprint 4) — un curso
 * requiere TODOS los cursos listados en `requires`, no hay OR.
 */
export interface PrerequisitoNodo {
  code: string
  name: string
  credits: number
  requires: PrerequisitoNodo[]
  /**
   * true cuando este nodo tenía prerrequisitos reales que no se
   * expandieron por el corte de profundidad (?profundidad=directo).
   * false en modo árbol completo (sin corte) o cuando de verdad no
   * tiene más prerrequisitos.
   */
  hasMoreRequirements: boolean
  /**
   * Correquisitos directos del curso raíz -- cursos que deben llevarse
   * EN SIMULTÁNEO, no antes. Solo viene completo en el nodo raíz (el
   * curso consultado); [] en cualquier nodo de `requires` (ver
   * prerrequisito.service.ts en el backend). Ya deduplicado y buscado
   * en ambas direcciones por el backend -- se usa tal cual.
   */
  corequisitos: CorequisitoRef[]
}

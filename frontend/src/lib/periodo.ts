import type { PeriodoRef } from "@/types/periodo"

/**
 * Nombre del período de una matrícula "cursando" SOLO si difiere del
 * período predeterminado (el que está en curso) -- null si es el mismo o
 * si no hay período. Dashboard, Malla y Mis Cursos lo muestran como
 * "Cursando en <nombre>" para no confundir un ciclo futuro con el actual.
 */
export function nombrePeriodoSiDistinto(
  periodoCursando: PeriodoRef | null,
  codigoReferencia: string | undefined
): string | null {
  if (!periodoCursando || !codigoReferencia) return null
  return periodoCursando.codigo === codigoReferencia ? null : periodoCursando.nombre
}

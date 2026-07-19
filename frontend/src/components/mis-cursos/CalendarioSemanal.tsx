import { useMemo } from "react"
import { useHorarioStore } from "@/store/horarioStore"
import {
  CalendarioSemanalGrid,
  type ConflictoNrc,
} from "@/components/shared/CalendarioSemanalGrid"

/**
 * Wrapper de Mis Cursos sobre el grid compartido: arma el borrador en vivo
 * (secciones fijas -- cursos "cursando" -- + manuales) y el mapa de
 * conflictos desde useHorarioStore, y le pasa el resultado ya resuelto a
 * CalendarioSemanalGrid (que no conoce el store, ver ese archivo).
 */
export function CalendarioSemanal() {
  const seccionesFijas = useHorarioStore((s) => s.seccionesFijas)
  const seccionesManuales = useHorarioStore((s) => s.seccionesManuales)
  const conflictos = useHorarioStore((s) => s.conflictos)

  const todasLasSecciones = useMemo(
    () => [...seccionesFijas.values(), ...seccionesManuales],
    [seccionesFijas, seccionesManuales]
  )

  // Por NRC, con qué otro(s) curso/NRC choca -- para el texto dentro del
  // bloque. Se arma en ambas direcciones (A->B y B->A) porque un
  // conflicto solo se guarda una vez pero afecta a los dos bloques.
  const conflictoPorNrc = useMemo(() => {
    const map = new Map<string, ConflictoNrc[]>()
    const agregar = (nrc: string, conCurso: string, conNrc: string) => {
      const lista = map.get(nrc) ?? []
      lista.push({ conCurso, conNrc })
      map.set(nrc, lista)
    }
    for (const c of conflictos) {
      agregar(c.seccionA.nrc, c.seccionB.codigoCurso, c.seccionB.nrc)
      agregar(c.seccionB.nrc, c.seccionA.codigoCurso, c.seccionA.nrc)
    }
    return map
  }, [conflictos])

  return (
    <CalendarioSemanalGrid secciones={todasLasSecciones} conflictoPorNrc={conflictoPorNrc} />
  )
}

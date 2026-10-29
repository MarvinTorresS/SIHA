import { useQuery } from "@tanstack/react-query"
import { periodosService } from "@/services/periodos.service"
import { miHorarioService } from "@/services/mi-horario.service"
import { usePeriodoStore } from "@/store/periodoStore"
import type { Periodo, PeriodoHorario } from "@/types/periodo"

/**
 * El elegido por el estudiante si está en la lista; si no, el
 * predeterminado. Así una selección recordada que ya no aplica (un ciclo
 * que cerró, o uno finalizado elegido en Mi Horario y que Mis Cursos no
 * ofrece) cae sola al vigente, sin borrar lo recordado.
 */
function resolverPeriodo<T extends Periodo>(periodos: T[] | undefined, codigoElegido: string | null) {
  return periodos?.find((p) => p.codigo === codigoElegido) ?? periodos?.find((p) => p.esPredeterminado)
}

/**
 * Período efectivo de las pantallas que dependen de la oferta (Mis
 * Cursos): solo ciclos activos.
 */
export function usePeriodoSeleccionado() {
  const codigoElegido = usePeriodoStore((s) => s.codigoElegido)
  const setCodigoElegido = usePeriodoStore((s) => s.setCodigoElegido)

  const { data: periodos, isLoading, error } = useQuery({
    queryKey: ["periodos"],
    queryFn: periodosService.listar,
    staleTime: 5 * 60 * 1000,
  })

  return {
    periodos: periodos ?? [],
    periodo: resolverPeriodo(periodos, codigoElegido),
    setPeriodo: setCodigoElegido,
    isLoading,
    error,
  }
}

/**
 * Período efectivo de Mi Horario: los activos más los finalizados donde el
 * estudiante todavía tiene cursos "cursando" (solo lectura). Comparte la
 * selección recordada con Mis Cursos.
 */
export function usePeriodoHorario(carnet: string | undefined) {
  const codigoElegido = usePeriodoStore((s) => s.codigoElegido)
  const setCodigoElegido = usePeriodoStore((s) => s.setCodigoElegido)

  const { data: periodos, isLoading, error } = useQuery({
    queryKey: ["periodos-horario", carnet],
    queryFn: () => miHorarioService.obtenerPeriodos(carnet!),
    enabled: !!carnet,
  })

  return {
    periodos: periodos ?? ([] as PeriodoHorario[]),
    periodo: resolverPeriodo(periodos, codigoElegido),
    setPeriodo: setCodigoElegido,
    isLoading,
    error,
  }
}

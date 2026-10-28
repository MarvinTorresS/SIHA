import { useQuery } from "@tanstack/react-query"
import { periodosService } from "@/services/periodos.service"
import { usePeriodoStore } from "@/store/periodoStore"
import type { Periodo } from "@/types/periodo"

/**
 * Período efectivo de las pantallas que dependen de la oferta: el que
 * eligió el estudiante si sigue activo, si no el predeterminado. Así una
 * selección recordada de un ciclo que ya cerró cae sola al vigente.
 */
export function usePeriodoSeleccionado() {
  const codigoElegido = usePeriodoStore((s) => s.codigoElegido)
  const setCodigoElegido = usePeriodoStore((s) => s.setCodigoElegido)

  const { data: periodos, isLoading, error } = useQuery({
    queryKey: ["periodos"],
    queryFn: periodosService.listar,
    staleTime: 5 * 60 * 1000,
  })

  const periodo: Periodo | undefined =
    periodos?.find((p) => p.codigo === codigoElegido) ??
    periodos?.find((p) => p.esPredeterminado)

  return {
    periodos: periodos ?? [],
    periodo,
    setPeriodo: setCodigoElegido,
    isLoading,
    error,
  }
}

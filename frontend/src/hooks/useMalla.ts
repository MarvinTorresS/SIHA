import { useQuery } from "@tanstack/react-query"
import { mallasService } from "@/services/mallas.service"
import type { CarreraSigla } from "@/types/academico"

export function useMalla(carrera: CarreraSigla, enabled = true) {
  return useQuery({
    queryKey: ["malla", carrera],
    queryFn: () => mallasService.obtener(carrera),
    staleTime: Infinity,
    enabled,
  })
}
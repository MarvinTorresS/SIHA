import { api } from "./api"
import type { Periodo } from "@/types/periodo"

export const periodosService = {
  /** GET /api/periodos -- activos, ordenados por código, con el predeterminado marcado. */
  listar() {
    return api.get<Periodo[]>("/periodos")
  },
}

/** Sufijo de query string para endpoints que aceptan ?periodo=. */
export function periodoQuery(codigo: string): string {
  return `?periodo=${encodeURIComponent(codigo)}`
}

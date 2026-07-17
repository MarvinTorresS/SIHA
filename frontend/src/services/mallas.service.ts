import { api } from "./api"
import type { MallaCarrera } from "@/types/malla"
import type { CarreraSigla } from "@/types/academico"

export const mallasService = {
  /** GET /api/mallas/{carrera} — carrera es la sigla: isi | itecad | topo */
  obtener(carrera: CarreraSigla) {
    return api.get<MallaCarrera>(`/mallas/${carrera}`)
  },
}

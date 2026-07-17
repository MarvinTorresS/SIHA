import { api } from "./api"
import type { PrerequisitoNodo } from "@/types/prerequisito"

export const prerequisitosService = {
  /** GET /api/prerrequisitos/{curso} — árbol recursivo, AND-simple */
  obtenerArbol(codigoCurso: string) {
    return api.get<PrerequisitoNodo>(`/prerrequisitos/${codigoCurso}`)
  },
  /**
   * GET /api/prerrequisitos/{curso}?profundidad=directo — solo el
   * primer nivel (prerrequisitos directos, sin expandir los suyos).
   */
  obtenerDirectos(codigoCurso: string) {
    return api.get<PrerequisitoNodo>(
      `/prerrequisitos/${codigoCurso}?profundidad=directo`
    )
  },
}

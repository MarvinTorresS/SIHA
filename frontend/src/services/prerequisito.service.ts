import { api } from "./api"
import type { PrerequisitoNodo } from "@/types/prerequisito"

export const prerequisitosService = {
  /**
   * GET /api/prerrequisitos/{curso} — árbol recursivo, AND-simple.
   * `carreraSigla` acota los prerrequisitos a los de esa carrera -- un
   * curso compartido entre carreras (ej. MAT002) puede tener requisitos
   * distintos según la carrera. undefined = unión de todas las carreras.
   */
  obtenerArbol(codigoCurso: string, carreraSigla?: string) {
    const query = carreraSigla ? `?carrera=${encodeURIComponent(carreraSigla)}` : ""
    return api.get<PrerequisitoNodo>(`/prerrequisitos/${codigoCurso}${query}`)
  },
  /**
   * GET /api/prerrequisitos/{curso}?profundidad=directo — solo el
   * primer nivel (prerrequisitos directos, sin expandir los suyos).
   * Mismo scoping por `carreraSigla` que obtenerArbol.
   */
  obtenerDirectos(codigoCurso: string, carreraSigla?: string) {
    const carreraParam = carreraSigla ? `&carrera=${encodeURIComponent(carreraSigla)}` : ""
    return api.get<PrerequisitoNodo>(
      `/prerrequisitos/${codigoCurso}?profundidad=directo${carreraParam}`
    )
  },
}

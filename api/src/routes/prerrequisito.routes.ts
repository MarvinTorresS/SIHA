import { Router } from "express";
import type { Request, Response } from "express";
import { getPrerequisiteTree } from "../services/prerrequisito.service";

const router = Router();

/**
 * GET /api/prerrequisitos/:curso
 * Devuelve el árbol de prerrequisitos del curso especificado por
 * su código exacto (ej. EIF207). El árbol es recursivo: cada nodo
 * contiene su lista de `requires`, que a su vez pueden tener sus
 * propios prerrequisitos.
 *
 * ?profundidad=directo corta el árbol en el primer nivel: `requires`
 * trae los prerrequisitos inmediatos, pero sin expandir los suyos --
 * cada uno señala `hasMoreRequirements` si de verdad tenía más atrás.
 * Cualquier otro valor (o el parámetro ausente) mantiene el árbol
 * completo de siempre.
 *
 * ?carrera=sigla (ej. "topo") acota los prerrequisitos a los que aplican
 * a esa carrera -- un curso compartido entre carreras (ej. MAT002) puede
 * tener requisitos distintos según la carrera. Sin este parámetro se
 * devuelve la unión de todas las carreras (comportamiento previo).
 *
 * Devuelve 404 si el curso no existe en la base de datos.
 */
router.get("/:curso", async (req: Request, res: Response) => {
  try {
    const codigo = (req.params as Record<string, string>).curso.toUpperCase();
    const maxDepth = req.query.profundidad === "directo" ? 1 : undefined;
    const carrera = typeof req.query.carrera === "string" ? req.query.carrera : undefined;
    const tree = await getPrerequisiteTree(codigo, maxDepth, carrera);

    if (!tree) {
      res.status(404).json({
        error: `Curso "${req.params.curso}" no encontrado`,
      });
      return;
    }

    res.json(tree);
  } catch (err) {
    console.error(`GET /api/prerrequisitos/${req.params.curso}:`, err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
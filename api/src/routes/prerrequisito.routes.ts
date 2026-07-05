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
 * Devuelve 404 si el curso no existe en la base de datos.
 */
router.get("/:curso", async (req: Request, res: Response) => {
  try {
    const codigo = (req.params as Record<string, string>).curso.toUpperCase();
    const tree = await getPrerequisiteTree(codigo);

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
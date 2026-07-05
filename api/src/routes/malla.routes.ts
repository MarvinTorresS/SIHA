import { Router } from "express";
import type { Request, Response } from "express";
import { getCurriculumByProgram } from "../services/malla.service";

const router = Router();

/**
 * GET /api/mallas/:carrera
 * Devuelve la malla curricular completa de una carrera, agrupada
 * por ciclo. :carrera es la sigla (ej. "isi", "itecad", "topo").
 * Devuelve 404 si la sigla no corresponde a ninguna carrera.
 */
router.get("/:carrera", async (req: Request, res: Response) => {
  try {
    const sigla = (req.params as Record<string, string>).carrera.toLowerCase();
    const malla = await getCurriculumByProgram(sigla);

    if (!malla) {
      res.status(404).json({
        error: `Carrera "${req.params.carrera}" no encontrada`,
      });
      return;
    }

    res.json(malla);
  } catch (err) {
    console.error(`GET /api/mallas/${req.params.carrera}:`, err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
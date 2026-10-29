import { Router } from "express";
import type { Request, Response } from "express";
import { listActivePeriods } from "../services/periodo.service";

const router = Router();

/**
 * GET /api/periodos
 * Períodos activos (seleccionables en SIHA) ordenados por código, con el
 * predeterminado marcado. Pública, igual que /api/cursos: no expone datos
 * de ningún estudiante.
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    res.json(await listActivePeriods());
  } catch (err) {
    console.error("GET /api/periodos:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;

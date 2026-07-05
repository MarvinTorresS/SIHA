import { Router } from "express";
import type { Request, Response } from "express";
import {
  listCourses,
  findCourseByCode,
  listCoursesByProgram,
} from "../services/curso.service";

const router = Router();

/**
 * GET /api/cursos
 * Query params opcionales: idCarrera (number), cicloId (string)
 *
 * Si el query param está ausente o vacío, se convierte a undefined
 * para que Prisma no filtre por ese campo (ver curso.service.ts).
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const idCarreraRaw = req.query.idCarrera as string | undefined;
    const cicloIdRaw = req.query.cicloId as string | undefined;

    // Se valida ANTES de convertir, para que quede explícito que un
    // idCarrera inválido corta la petición aquí mismo con 400, sin
    // llegar a construir el filtro para el servicio.
    if (idCarreraRaw && idCarreraRaw !== "" && isNaN(Number(idCarreraRaw))) {
      res.status(400).json({ error: "idCarrera debe ser un número" });
      return;
    }

    const idCarrera =
      idCarreraRaw && idCarreraRaw !== "" ? Number(idCarreraRaw) : undefined;
    const cicloId = cicloIdRaw && cicloIdRaw !== "" ? cicloIdRaw : undefined;

    const cursos = await listCourses({ idCarrera, cicloId });
    res.json(cursos);
  } catch (err) {
    console.error("GET /api/cursos:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * GET /api/cursos/carrera/:id
 * Lista los cursos de una carrera por su id numérico.
 * Va antes de /:codigo para que Express no confunda "carrera" con un código.
 */
router.get("/carrera/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      res.status(400).json({ error: "El id de carrera debe ser un número" });
      return;
    }

    const cursos = await listCoursesByProgram(id);
    res.json(cursos);
  } catch (err) {
    console.error(`GET /api/cursos/carrera/${req.params.id}:`, err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * GET /api/cursos/:codigo
 * Busca un curso por su código exacto (ej. EIF207).
 * Devuelve 404 si no existe.
 */
router.get("/:codigo", async (req: Request, res: Response) => {
  try {
    const codigo = (req.params as Record<string, string>).codigo.toUpperCase();
    const curso = await findCourseByCode(codigo);

    if (!curso) {
      res.status(404).json({ error: `Curso ${codigo} no encontrado` });
      return;
    }

    res.json(curso);
  } catch (err) {
    console.error(`GET /api/cursos/${req.params.codigo}:`, err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
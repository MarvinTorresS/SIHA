import { Router } from "express";
import type { Request, Response } from "express";
import {
  validateScheduleByNrc,
  NrcNotFoundError,
} from "../services/horario.service";
import { prisma } from "../db";

const router = Router();

/**
 * Convierte un valor DateTime de Prisma (columna TIME de Postgres,
 * mapeada internamente a una fecha base) al formato "HH:MM".
 */
function timeToHourString(value: Date): string {
  const hours = value.getUTCHours().toString().padStart(2, "0");
  const minutes = value.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * GET /api/horarios/secciones/:codigo
 * Devuelve todas las secciones disponibles para un curso, con sus
 * bloques horarios, profesor, capacidad, etc.
 * Útil para optativos y cursos fuera de ciclo donde el estudiante
 * elige manualmente entre varias secciones.
 *
 * Ejemplo: GET /api/horarios/secciones/EIF425O
 */
router.get("/secciones/:codigo", async (req: Request, res: Response) => {
  try {
    const codigo = (req.params as Record<string, string>).codigo.toUpperCase();

    const secciones = await prisma.seccion.findMany({
      where: { codigo_curso_banner: codigo },
      include: {
        horario_bloque: true,
        profesor: true,
      },
      orderBy: { numero_seccion: "asc" },
    });

    if (secciones.length === 0) {
      res.status(404).json({
        error: `No se encontraron secciones para el curso ${codigo}`,
      });
      return;
    }

    const result = secciones.map((s) => ({
      nrc: s.nrc,
      codigoCurso: s.codigo_curso_banner,
      titulo: s.titulo,
      seccion: s.numero_seccion,
      creditos: Number(s.creditos),
      capacidad: s.capacidad,
      inscritos: s.inscritos,
      disponibles: s.disponibles,
      estadoOferta: s.estado_oferta,
      profesor: s.profesor?.nombre ?? null,
      horarios: s.horario_bloque.map((h) => ({
        dia: h.dia,
        horaInicio: timeToHourString(h.hora_inicio),
        horaFin: timeToHourString(h.hora_fin),
        aula: h.aula,
      })),
    }));

    res.json(result);
  } catch (err) {
    console.error(`GET /api/horarios/secciones/${req.params.codigo}:`, err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});
/**
 * GET /api/horarios/nrc/:nrc
 * Devuelve una sección individual por su NRC.
 *
 * Se usa findFirst en vez de findUnique porque la constraint unique
 * real en la BD es (nrc, id_periodo), no nrc solo. Para este endpoint
 * alcanza con buscar por nrc y asumir un solo período activo.
 */
router.get("/nrc/:nrc", async (req: Request, res: Response) => {
  try {
    const nrc = (req.params as Record<string, string>).nrc;

    const seccion = await prisma.seccion.findFirst({
      where: { nrc },
      include: {
        horario_bloque: true,
        profesor: true,
      },
    });

    if (!seccion) {
      res.status(404).json({
        error: `No se encontró la sección con NRC ${nrc}`,
      });
      return;
    }

    const result = {
      nrc: seccion.nrc,
      codigoCurso: seccion.codigo_curso_banner,
      titulo: seccion.titulo,
      seccion: seccion.numero_seccion,
      creditos: Number(seccion.creditos),
      capacidad: seccion.capacidad,
      inscritos: seccion.inscritos,
      disponibles: seccion.disponibles,
      estadoOferta: seccion.estado_oferta,
      profesor: seccion.profesor?.nombre ?? null,
      horarios: seccion.horario_bloque.map((h) => ({
        dia: h.dia,
        horaInicio: timeToHourString(h.hora_inicio),
        horaFin: timeToHourString(h.hora_fin),
        aula: h.aula,
      })),
    };

    res.json(result);
  } catch (err) {
    console.error(`GET /api/horarios/nrc/${req.params.nrc}:`, err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * POST /api/horarios/validar
 * Recibe un body { nrcs: string[] } con la lista de NRCs de las
 * secciones que el estudiante va a cursar (asignadas
 * institucionalmente y/o elegidas manualmente para optativos o
 * cursos fuera de ciclo). Devuelve si hay conflictos de horario y el
 * detalle de cada uno.
 *
 * Devuelve 400 si el body no trae un array de NRCs válido, o si
 * alguno de los NRCs no existe en la BD.
 */
router.post("/validar", async (req: Request, res: Response) => {
  try {
    const { nrcs } = req.body as { nrcs?: unknown };

    if (!Array.isArray(nrcs) || nrcs.length === 0) {
      res.status(400).json({
        error: "El body debe incluir 'nrcs' como un arreglo no vacío de strings",
      });
      return;
    }

    if (!nrcs.every((nrc) => typeof nrc === "string")) {
      res.status(400).json({ error: "Todos los elementos de 'nrcs' deben ser strings" });
      return;
    }

    const result = await validateScheduleByNrc(nrcs);
    res.json(result);
  } catch (err) {
    if (err instanceof NrcNotFoundError) {
      res.status(400).json({
        error: err.message,
        missingNrcs: err.missingNrcs,
      });
      return;
    }

    console.error("POST /api/horarios/validar:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
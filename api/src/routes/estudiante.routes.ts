import { Router, Request, Response } from "express";
import {
  getMallaProgreso,
  getOfertaCiclo,
  confirmarMatricula,
  marcarCursoAprobado,
  desmarcarCurso,
  EstudianteNoEncontradoError,
  PeriodoActivoInvalidoError,
  CursoNoEncontradoError,
  CursoFueraDeCarreraError,
  CursoNoMarcableError,
  SeccionNoEncontradaError,
} from "../services/estudiante.service";
import { requireAuth, requireOwnCarnet } from "../middleware/requireAuth";

export const estudianteRouter = Router();

/**
 * GET /api/estudiantes/:carnet/malla-progreso
 *
 * Devuelve la malla completa del estudiante agrupada por semestre, con el
 * estado de cada curso ya resuelto (aprobado / cursando / sin_seccion /
 * pendiente). Ver estudiante.service.ts para la regla completa de sin_seccion.
 *
 * Protegida: requiere sesión y que el :carnet de la URL sea el del propio
 * estudiante autenticado (requireOwnCarnet) -- antes era pública y
 * cualquiera podía pedir el progreso de cualquier carnet.
 */
estudianteRouter.get(
  "/estudiantes/:carnet/malla-progreso",
  requireAuth,
  requireOwnCarnet,
  async (req: Request, res: Response) => {
    const carnet = req.params.carnet as string;

    try {
      const progreso = await getMallaProgreso(carnet);
      return res.json(progreso);
    } catch (err) {
      if (err instanceof EstudianteNoEncontradoError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof PeriodoActivoInvalidoError) {
        // Error de configuración de datos, no del cliente -> 500.
        return res.status(500).json({ error: err.message });
      }
      // Red de seguridad; el errorHandler global también lo captura si
      // este bloque se omite, pero se deja explícito por consistencia
      // con el resto de rutas del proyecto.
      console.error("Error en GET /estudiantes/:carnet/malla-progreso", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

/**
 * GET /api/estudiantes/:carnet/oferta
 *
 * Oferta de cursos del período activo para la carrera del propio
 * estudiante, con estado ya resuelto (aprobado / cursando / elegible /
 * bloqueado) cruzando Banner + historial + el motor de prerrequisitos.
 * Ver getOfertaCiclo en estudiante.service.ts para el detalle completo.
 *
 * Protegida igual que malla-progreso: requiere sesión y que :carnet sea
 * el del propio estudiante.
 */
estudianteRouter.get(
  "/estudiantes/:carnet/oferta",
  requireAuth,
  requireOwnCarnet,
  async (req: Request, res: Response) => {
    const carnet = req.params.carnet as string;

    try {
      const oferta = await getOfertaCiclo(carnet);
      return res.json(oferta);
    } catch (err) {
      if (err instanceof EstudianteNoEncontradoError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof PeriodoActivoInvalidoError) {
        return res.status(500).json({ error: err.message });
      }
      console.error("Error en GET /estudiantes/:carnet/oferta", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

/**
 * POST /api/estudiantes/:carnet/matricula
 * Body: { nrcs: string[] }
 *
 * Confirma la matrícula del borrador armado en Mis Cursos: cada NRC pasa
 * su curso a estado 'cursando' en historial_curso. Ver confirmarMatricula
 * en estudiante.service.ts (transacción, no hay matrícula parcial).
 */
estudianteRouter.post(
  "/estudiantes/:carnet/matricula",
  requireAuth,
  requireOwnCarnet,
  async (req: Request, res: Response) => {
    const carnet = req.params.carnet as string;
    const { nrcs } = req.body as { nrcs?: unknown };

    if (!Array.isArray(nrcs) || nrcs.length === 0) {
      return res.status(400).json({
        error: "El body debe incluir 'nrcs' como un arreglo no vacío de strings",
      });
    }
    if (!nrcs.every((nrc) => typeof nrc === "string")) {
      return res.status(400).json({ error: "Todos los elementos de 'nrcs' deben ser strings" });
    }

    try {
      await confirmarMatricula(carnet, nrcs);
      return res.status(204).send();
    } catch (err) {
      if (err instanceof EstudianteNoEncontradoError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof SeccionNoEncontradaError) {
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof CursoFueraDeCarreraError) {
        return res.status(403).json({ error: err.message });
      }
      if (err instanceof PeriodoActivoInvalidoError) {
        return res.status(500).json({ error: err.message });
      }
      console.error("Error en POST /estudiantes/:carnet/matricula", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

/**
 * POST /api/estudiantes/:carnet/historial
 * Body: { codigoCurso }
 *
 * Marca un curso como aprobado en el historial del propio estudiante
 * (única acción soportada por ahora -- no edición de "cursando").
 */
estudianteRouter.post(
  "/estudiantes/:carnet/historial",
  requireAuth,
  requireOwnCarnet,
  async (req: Request, res: Response) => {
    const carnet = req.params.carnet as string;
    const { codigoCurso } = req.body ?? {};

    if (!codigoCurso || typeof codigoCurso !== "string") {
      return res.status(400).json({ error: "codigoCurso es requerido" });
    }

    try {
      await marcarCursoAprobado(carnet, codigoCurso);
      return res.status(204).send();
    } catch (err) {
      if (err instanceof EstudianteNoEncontradoError || err instanceof CursoNoEncontradoError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof CursoFueraDeCarreraError) {
        return res.status(403).json({ error: err.message });
      }
      console.error("Error en POST /estudiantes/:carnet/historial", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

/**
 * DELETE /api/estudiantes/:carnet/historial/:codigoCurso
 *
 * Deshace un "marcar como aprobado" (Malla) O una matrícula confirmada
 * en estado "cursando" (Mis Cursos) -- misma acción desde la perspectiva
 * del estudiante, ver desmarcarCurso en estudiante.service.ts.
 */
estudianteRouter.delete(
  "/estudiantes/:carnet/historial/:codigoCurso",
  requireAuth,
  requireOwnCarnet,
  async (req: Request, res: Response) => {
    const carnet = req.params.carnet as string;
    const codigoCurso = req.params.codigoCurso as string;

    try {
      await desmarcarCurso(carnet, codigoCurso);
      return res.status(204).send();
    } catch (err) {
      if (err instanceof EstudianteNoEncontradoError || err instanceof CursoNoEncontradoError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof CursoNoMarcableError) {
        return res.status(409).json({ error: err.message });
      }
      console.error("Error en DELETE /estudiantes/:carnet/historial/:codigoCurso", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);
import { Router, Request, Response } from "express";
import {
  getMallaProgreso,
  getOfertaCiclo,
  confirmarMatricula,
  marcarCursoAprobado,
  desmarcarCurso,
  getSeccionesCursando,
  getPeriodosHorario,
  obtenerOpcionesParaSlot,
  asignarCursoRealASlot,
  desasignarSlotMalla,
  EstudianteNoEncontradoError,
  CursoNoEncontradoError,
  CursoFueraDeCarreraError,
  CursoNoMarcableError,
  SeccionNoEncontradaError,
  SlotInvalidoError,
  TopeSlotsAlcanzadoError,
  CursoYaAsignadoAOtroSlotError,
  TopeGeneralesMatriculaError,
  TopeOptativasMatriculaError,
  CursoYaAprobadoError,
  CursoCursandoEnOtroPeriodoError,
  PrerrequisitosNoCumplidosError,
} from "../services/estudiante.service";
import { requireAuth, requireOwnCarnet } from "../middleware/requireAuth";
import { respondPeriodError } from "../middleware/periodErrors";
import { readPeriodQuery } from "../services/periodo.service";

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
      if (respondPeriodError(err, res)) return;
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
 * Query opcional: ?periodo=<codigo> (default: el período predeterminado).
 *
 * Oferta de cursos de un período para la carrera del propio
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
      const oferta = await getOfertaCiclo(carnet, readPeriodQuery(req.query.periodo));
      return res.json(oferta);
    } catch (err) {
      if (err instanceof EstudianteNoEncontradoError) {
        return res.status(404).json({ error: err.message });
      }
      if (respondPeriodError(err, res)) return;
      console.error("Error en GET /estudiantes/:carnet/oferta", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

/**
 * GET /api/estudiantes/:carnet/secciones-cursando
 *
 * Secciones confirmadas ("cursando") del estudiante, para la pantalla Mi
 * Horario -- lee directo de historial_curso, independiente de la oferta
 * de un período (a diferencia de /oferta). Query opcional: ?periodo=<codigo>;
 * acepta un período finalizado solo si el estudiante tiene 'cursando' en él. Ver getSeccionesCursando
 * en estudiante.service.ts.
 */
estudianteRouter.get(
  "/estudiantes/:carnet/secciones-cursando",
  requireAuth,
  requireOwnCarnet,
  async (req: Request, res: Response) => {
    const carnet = req.params.carnet as string;

    try {
      const secciones = await getSeccionesCursando(carnet, readPeriodQuery(req.query.periodo));
      return res.json(secciones);
    } catch (err) {
      if (err instanceof EstudianteNoEncontradoError) {
        return res.status(404).json({ error: err.message });
      }
      if (respondPeriodError(err, res)) return;
      console.error("Error en GET /estudiantes/:carnet/secciones-cursando", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

/**
 * GET /api/estudiantes/:carnet/periodos-horario
 *
 * Períodos del selector de Mi Horario: los activos más los finalizados
 * donde el estudiante todavía tiene cursos 'cursando' (finalizado=true,
 * solo lectura). Mis Cursos usa GET /api/periodos (solo activos).
 */
estudianteRouter.get(
  "/estudiantes/:carnet/periodos-horario",
  requireAuth,
  requireOwnCarnet,
  async (req: Request, res: Response) => {
    const carnet = req.params.carnet as string;
    try {
      return res.json(await getPeriodosHorario(carnet));
    } catch (err) {
      if (err instanceof EstudianteNoEncontradoError) {
        return res.status(404).json({ error: err.message });
      }
      console.error("Error en GET /estudiantes/:carnet/periodos-horario", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

/**
 * POST /api/estudiantes/:carnet/matricula
 * Body: { nrcs: string[] }  Query opcional: ?periodo=<codigo>
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
      await confirmarMatricula(carnet, nrcs, readPeriodQuery(req.query.periodo));
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
      if (err instanceof TopeGeneralesMatriculaError) {
        return res.status(409).json({ error: err.message });
      }
      if (err instanceof TopeOptativasMatriculaError) {
        return res.status(409).json({ error: err.message });
      }
      if (
        err instanceof CursoYaAprobadoError ||
        err instanceof CursoCursandoEnOtroPeriodoError ||
        err instanceof PrerrequisitosNoCumplidosError
      ) {
        return res.status(409).json({ error: err.message });
      }
      if (respondPeriodError(err, res)) return;
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

/**
 * GET /api/estudiantes/:carnet/malla-slots/:slotCodigo/opciones
 *
 * Opciones disponibles para llenar un slot GEN{n}/OPT{n} de la malla del
 * propio estudiante (catálogo real de Generales/Optativas, menos lo que
 * ya está usado en otro slot), o el estado "tope_alcanzado" si ya no
 * quedan cupos -- ver obtenerOpcionesParaSlot en estudiante.service.ts.
 */
estudianteRouter.get(
  "/estudiantes/:carnet/malla-slots/:slotCodigo/opciones",
  requireAuth,
  requireOwnCarnet,
  async (req: Request, res: Response) => {
    const carnet = req.params.carnet as string;
    const slotCodigo = req.params.slotCodigo as string;

    try {
      const opciones = await obtenerOpcionesParaSlot(carnet, slotCodigo);
      return res.json(opciones);
    } catch (err) {
      if (err instanceof EstudianteNoEncontradoError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof SlotInvalidoError) {
        return res.status(400).json({ error: err.message });
      }
      console.error("Error en GET /estudiantes/:carnet/malla-slots/:slotCodigo/opciones", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

/**
 * POST /api/estudiantes/:carnet/malla-slots/:slotCodigo
 * Body: { cursoRealCodigo } | { cursoRealNombre }
 *
 * Asigna explícitamente un curso real (del catálogo o creado a mano vía
 * "Otro") al slot GEN{n}/OPT{n} -- ver asignarCursoRealASlot.
 */
estudianteRouter.post(
  "/estudiantes/:carnet/malla-slots/:slotCodigo",
  requireAuth,
  requireOwnCarnet,
  async (req: Request, res: Response) => {
    const carnet = req.params.carnet as string;
    const slotCodigo = req.params.slotCodigo as string;
    const { cursoRealCodigo, cursoRealNombre } = req.body ?? {};

    if (typeof cursoRealCodigo !== "string" && typeof cursoRealNombre !== "string") {
      return res.status(400).json({
        error: "Se requiere cursoRealCodigo o cursoRealNombre",
      });
    }

    try {
      const seleccion =
        typeof cursoRealCodigo === "string" ? { cursoRealCodigo } : { cursoRealNombre };
      await asignarCursoRealASlot(carnet, slotCodigo, seleccion);
      return res.status(204).send();
    } catch (err) {
      if (err instanceof EstudianteNoEncontradoError || err instanceof CursoNoEncontradoError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof SlotInvalidoError) {
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof TopeSlotsAlcanzadoError || err instanceof CursoYaAsignadoAOtroSlotError) {
        return res.status(409).json({ error: err.message });
      }
      console.error("Error en POST /estudiantes/:carnet/malla-slots/:slotCodigo", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

/**
 * DELETE /api/estudiantes/:carnet/malla-slots/:slotCodigo
 *
 * Desasigna el curso real de un slot GEN{n}/OPT{n} -- ver desasignarSlotMalla.
 */
estudianteRouter.delete(
  "/estudiantes/:carnet/malla-slots/:slotCodigo",
  requireAuth,
  requireOwnCarnet,
  async (req: Request, res: Response) => {
    const carnet = req.params.carnet as string;
    const slotCodigo = req.params.slotCodigo as string;

    try {
      await desasignarSlotMalla(carnet, slotCodigo);
      return res.status(204).send();
    } catch (err) {
      if (err instanceof EstudianteNoEncontradoError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof SlotInvalidoError) {
        return res.status(400).json({ error: err.message });
      }
      console.error("Error en DELETE /estudiantes/:carnet/malla-slots/:slotCodigo", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);
import { Router } from "express";
import type { Request, Response } from "express";
import {
  registrar,
  login,
  obtenerPorCarnet,
  CarnetOCorreoDuplicadoError,
  CarreraNoEncontradaError,
  CredencialesInvalidasError,
  EstudianteNoEncontradoError,
} from "../services/auth.service";
import { requireAuth } from "../middleware/requireAuth";

export const authRouter = Router();

/**
 * POST /api/auth/registro
 * Body: { carnet, nombre, correo, password, carreraSigla }
 */
authRouter.post("/auth/registro", async (req: Request, res: Response) => {
  const { carnet, nombre, correo, password, carreraSigla } = req.body ?? {};

  if (!carnet || !nombre || !correo || !password || !carreraSigla) {
    res.status(400).json({
      error: "carnet, nombre, correo, password y carreraSigla son requeridos",
    });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    return;
  }

  try {
    const sesion = await registrar({ carnet, nombre, correo, password, carreraSigla });
    res.status(201).json(sesion);
  } catch (err) {
    if (err instanceof CarreraNoEncontradaError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof CarnetOCorreoDuplicadoError) {
      res.status(409).json({ error: err.message });
      return;
    }
    console.error("Error en POST /auth/registro:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * POST /api/auth/login
 * Body: { carnet, password }
 */
authRouter.post("/auth/login", async (req: Request, res: Response) => {
  const { carnet, password } = req.body ?? {};

  if (!carnet || !password) {
    res.status(400).json({ error: "carnet y password son requeridos" });
    return;
  }

  try {
    const sesion = await login({ carnet, password });
    res.json(sesion);
  } catch (err) {
    if (err instanceof CredencialesInvalidasError) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("Error en POST /auth/login:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * GET /api/auth/me
 * Hidrata la sesión del frontend a partir del token guardado en
 * localStorage, sin que el estudiante tenga que loguearse de nuevo en
 * cada refresh de página.
 */
authRouter.get("/auth/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const estudiante = await obtenerPorCarnet(req.auth!.carnet);
    res.json({ estudiante });
  } catch (err) {
    if (err instanceof EstudianteNoEncontradoError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error("Error en GET /auth/me:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

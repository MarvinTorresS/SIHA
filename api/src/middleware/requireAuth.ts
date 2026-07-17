import type { Request, Response, NextFunction } from "express";
import { verificarToken, type JwtPayload } from "../services/auth.service";

// Amplía Request para que las rutas protegidas lean req.auth sin castear.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

/**
 * Exige un JWT válido en "Authorization: Bearer <token>". Si es válido,
 * expone el payload decodificado en req.auth (carnet + carreraSigla) para
 * que la ruta lo use sin volver a decodificar ni confiar en el :carnet
 * de la URL.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    res.status(401).json({ error: "Token de autenticación requerido" });
    return;
  }

  try {
    req.auth = verificarToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
}

/**
 * Para rutas con :carnet en la URL: exige que coincida con el carnet del
 * token, para que un estudiante autenticado no pueda leer/editar el
 * historial de otro cambiando el parámetro de la URL. Debe montarse
 * DESPUÉS de requireAuth (depende de req.auth).
 */
export function requireOwnCarnet(req: Request, res: Response, next: NextFunction): void {
  const carnetUrl = req.params.carnet;
  if (req.auth?.carnet !== carnetUrl) {
    res.status(403).json({ error: "No autorizado para acceder a este recurso" });
    return;
  }
  next();
}

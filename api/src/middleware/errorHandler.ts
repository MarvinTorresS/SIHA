import type { Request, Response, NextFunction } from "express";

/**
 * Manejador de rutas no encontradas. Se monta DESPUÉS de todas las
 * rutas reales (/api/cursos, /api/mallas, /api/prerrequisitos), así
 * que solo se activa si ninguna de ellas coincidió con la petición.
 * Devuelve un JSON consistente en vez del HTML de error por defecto
 * de Express.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Middleware de errores global. Es una red de seguridad para
 * excepciones que ninguna ruta capturó con su propio try/catch
 * (ej. errores lanzados por un middleware previo, JSON malformado
 * en el body, etc.). Las rutas ya manejan sus propios errores de
 * Prisma/negocio con try/catch + 500, así que este middleware no
 * debería activarse en el flujo normal -- si se activa, es señal
 * de un caso no previsto que vale la pena revisar en los logs.
 *
 * Debe registrarse al FINAL de todos los app.use(), con 4 parámetros
 * exactos (err, req, res, next): así es como Express reconoce que
 * es un manejador de errores y no una ruta normal.
 */
export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  console.error(`Error no manejado en ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: "Error interno del servidor" });
}
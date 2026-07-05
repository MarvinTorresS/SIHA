import express from "express";
import cursoRoutes from "./routes/curso.routes";
import mallaRoutes from "./routes/malla.routes";
import prerrequisitoRoutes from "./routes/prerrequisito.routes";
import { notFoundHandler, globalErrorHandler } from "./middleware/errorHandler";

/**
 * Crea y configura la instancia de Express, SIN levantar el servidor
 * (sin app.listen). Se separa de index.ts para que los tests de
 * integración puedan importar esta misma app y hacerle peticiones
 * con supertest, sin necesidad de un puerto real ni de arrancar/parar
 * un proceso de servidor en cada test.
 */
export function createApp() {
  const app = express();

  app.use(express.json());

  app.use("/api/cursos", cursoRoutes);
  app.use("/api/mallas", mallaRoutes);
  app.use("/api/prerrequisitos", prerrequisitoRoutes);

  // Igual que en index.ts: deben ir al final, después de todas las rutas.
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}
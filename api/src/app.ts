import express from "express";
import cursoRoutes from "./routes/curso.routes";
import mallaRoutes from "./routes/malla.routes";
import prerrequisitoRoutes from "./routes/prerrequisito.routes";
import horarioRoutes from "./routes/horario.routes";
import { notFoundHandler, globalErrorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(express.json());

  app.use("/api/cursos", cursoRoutes);
  app.use("/api/mallas", mallaRoutes);
  app.use("/api/prerrequisitos", prerrequisitoRoutes);
  app.use("/api/horarios", horarioRoutes);

  // Igual que en index.ts: deben ir al final, después de todas las rutas.
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}
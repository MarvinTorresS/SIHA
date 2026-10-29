import express from "express";
import cors from "cors";
import cursoRoutes from "./routes/curso.routes";
import mallaRoutes from "./routes/malla.routes";
import prerrequisitoRoutes from "./routes/prerrequisito.routes";
import horarioRoutes from "./routes/horario.routes";
import periodoRoutes from "./routes/periodo.routes";
import { notFoundHandler, globalErrorHandler } from "./middleware/errorHandler";
import { estudianteRouter } from "./routes/estudiante.routes"; // ajusta la ruta real
import { authRouter } from "./routes/auth.routes";

export function createApp() {
  const app = express();

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim());

  app.use(
    cors({
      origin: allowedOrigins,
    })
  );
  app.use(express.json());

  app.use("/api/cursos", cursoRoutes);
  app.use("/api/mallas", mallaRoutes);
  app.use("/api/prerrequisitos", prerrequisitoRoutes);
  app.use("/api/horarios", horarioRoutes);
  app.use("/api/periodos", periodoRoutes);
  app.use("/api", estudianteRouter);
  app.use("/api", authRouter);


  // Igual que en index.ts: deben ir al final, después de todas las rutas.
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}
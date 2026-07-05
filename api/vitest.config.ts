import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Los tests de integracion hablan con PostgreSQL real, asi que
    // corren en serie (no en paralelo) para evitar que dos tests
    // choquen al usar la misma conexion/pool de Prisma al mismo tiempo.
    fileParallelism: false,
  },
});
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

/**
 * Tests de integracion contra la base de datos real (horarios-db en
 * Docker), no contra un mock. Usan datos que sabemos que existen:
 *
 * - Curso EIF207 requiere EIF203 y EIF204 (confirmado via query real
 *   a la tabla prerrequisito).
 * - Carrera "isi" (id_carrera = 7): Ingenieria en Sistemas Informaticos.
 *
 * Requisito para correr estos tests: el contenedor horarios-db debe
 * estar levantado (docker compose up) y con los datos de Sprint 3
 * ya cargados (populate_db.py ya ejecutado).
 */

const app = createApp();

describe("GET /api/cursos", () => {
  it("lista cursos sin filtros", async () => {
    const res = await request(app).get("/api/cursos");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("filtra por idCarrera", async () => {
    const res = await request(app).get("/api/cursos?idCarrera=7");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Todos los cursos devueltos deben pertenecer a la carrera 7 (isi)
    for (const curso of res.body) {
      expect(curso.id_carrera).toBe(7);
    }
  });

  it("responde 400 si idCarrera no es un numero", async () => {
    const res = await request(app).get("/api/cursos?idCarrera=abc");

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

describe("GET /api/cursos/:codigo", () => {
  it("encuentra un curso real por su codigo", async () => {
    const res = await request(app).get("/api/cursos/EIF207");

    expect(res.status).toBe(200);
    expect(res.body.codigo).toBe("EIF207");
  });

  it("es tolerante a minusculas en el codigo", async () => {
    const res = await request(app).get("/api/cursos/eif207");

    expect(res.status).toBe(200);
    expect(res.body.codigo).toBe("EIF207");
  });

  it("responde 404 si el curso no existe", async () => {
    const res = await request(app).get("/api/cursos/NOEXISTE999");

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

describe("GET /api/cursos/carrera/:id", () => {
  it("lista los cursos de una carrera real (isi, id=7)", async () => {
    const res = await request(app).get("/api/cursos/carrera/7");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("responde 400 si el id no es un numero", async () => {
    const res = await request(app).get("/api/cursos/carrera/abc");

    expect(res.status).toBe(400);
  });
});

describe("GET /api/mallas/:carrera", () => {
  it("devuelve la malla completa de isi agrupada por ciclo", async () => {
    const res = await request(app).get("/api/mallas/isi");

    expect(res.status).toBe(200);
    expect(res.body.programAcronym).toBe("isi");
    expect(Array.isArray(res.body.cycles)).toBe(true);
    expect(res.body.cycles.length).toBeGreaterThan(0);
  });

  it("el ciclo Opt aparece con nombre normalizado 'Optativos'", async () => {
    const res = await request(app).get("/api/mallas/isi");

    const optCycle = res.body.cycles.find(
      (c: { cycleId: string }) => c.cycleId === "Opt"
    );

    // Solo se verifica si la carrera tiene ciclo optativo cargado;
    // si no lo tiene, este assert se salta sin fallar el test.
    if (optCycle) {
      expect(optCycle.cycleName).toBe("Optativos");
    }
  });

  it("responde 404 si la sigla no existe", async () => {
    const res = await request(app).get("/api/mallas/noexiste");

    expect(res.status).toBe(404);
  });
});

describe("GET /api/prerrequisitos/:curso", () => {
  it("construye el arbol de prerrequisitos de EIF207", async () => {
    const res = await request(app).get("/api/prerrequisitos/EIF207");

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("EIF207");

    const requiredCodes = res.body.requires.map(
      (r: { code: string }) => r.code
    );

    // AND simple: EIF207 requiere EIF203 y EIF204 (ambos, no alternativos)
    expect(requiredCodes).toContain("EIF203");
    expect(requiredCodes).toContain("EIF204");
  });

  it("responde 404 si el curso no existe", async () => {
    const res = await request(app).get("/api/prerrequisitos/NOEXISTE999");

    expect(res.status).toBe(404);
  });
});

describe("Manejo de rutas no definidas", () => {
  it("responde 404 JSON para una ruta que no existe", async () => {
    const res = await request(app).get("/api/ruta-inventada");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Ruta no encontrada");
  });
});
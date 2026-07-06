import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("POST /api/horarios/validar", () => {
  it("detecta conflicto entre dos NRCs reales (mismo día, mismo horario)", async () => {
    const res = await request(app)
      .post("/api/horarios/validar")
      .send({ nrcs: ["50884", "50912"] });  // EIF200 + EIF400, viernes 13:00

    expect(res.status).toBe(200);
    expect(res.body.tieneConflictos).toBe(true);
    expect(res.body.conflictos.length).toBeGreaterThan(0);
    expect(res.body.conflictos[0].seccionA).toBeDefined();
    expect(res.body.conflictos[0].seccionB).toBeDefined();
    expect(res.body.conflictos[0].dia).toBeDefined();
  });

  it("no detecta conflicto para un solo NRC", async () => {
    const res = await request(app)
      .post("/api/horarios/validar")
      .send({ nrcs: ["50872"] });  // MAT002

    expect(res.status).toBe(200);
    expect(res.body.tieneConflictos).toBe(false);
    expect(res.body.conflictos).toEqual([]);
  });

  it("responde 400 si nrcs no es un array", async () => {
    const res = await request(app)
      .post("/api/horarios/validar")
      .send({ nrcs: "no-es-array" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("responde 400 si nrcs está vacío", async () => {
    const res = await request(app)
      .post("/api/horarios/validar")
      .send({ nrcs: [] });

    expect(res.status).toBe(400);
  });

  it("responde 400 si algún NRC no existe", async () => {
    const res = await request(app)
      .post("/api/horarios/validar")
      .send({ nrcs: ["99999"] });

    expect(res.status).toBe(400);
    expect(res.body.missingNrcs).toContain("99999");
  });
});

describe("GET /api/horarios/secciones/:codigo", () => {
  it("devuelve secciones para un curso real", async () => {
    const res = await request(app)
      .get("/api/horarios/secciones/EIF200");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].nrc).toBeDefined();
    expect(res.body[0].horarios).toBeDefined();
  });

  it("responde 404 si el curso no tiene secciones", async () => {
    const res = await request(app)
      .get("/api/horarios/secciones/NOEXISTE999");

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
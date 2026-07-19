import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

/**
 * Tests de integracion contra la base de datos real (horarios-db en
 * Docker), igual que api.integration.test.ts / horarios.integration.test.ts.
 *
 * A diferencia de esos, DELETE /historial/:codigoCurso escribe/borra
 * filas de historial_curso -- para no tocar estudiantes reales (mock o
 * de desarrollo), se crea un estudiante descartable en beforeAll y se
 * borra en afterAll (onDelete: Cascade limpia su historial_curso solo).
 * El curso/carrera que usa SÍ son datos reales ya sembrados, no fixtures.
 */

const app = createApp();
const CARNET_TEST = "TEST-DESM-999"; // <= VARCHAR(20); "-MAT" suffix used below stays under el límite

function tokenPara(carnet: string, carreraSigla: string): string {
  return jwt.sign({ carnet, carreraSigla }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
  });
}

describe("DELETE /api/estudiantes/:carnet/historial/:codigoCurso", () => {
  let idEstudiante: number;
  let idCurso: number;
  let codigoCurso: string;
  let token: string;

  beforeAll(async () => {
    const carreraIsi = await prisma.carrera.findUniqueOrThrow({
      where: { sigla: "isi" },
    });

    // Cualquier curso real de la malla de isi sirve -- no importa cuál,
    // solo que exista y pertenezca a la carrera del estudiante de prueba.
    const cc = await prisma.curso_carrera.findFirstOrThrow({
      where: { id_carrera: carreraIsi.id_carrera },
      include: { curso: true },
    });
    idCurso = cc.curso.id_curso;
    codigoCurso = cc.curso.codigo;

    const estudiante = await prisma.estudiante.create({
      data: {
        carnet: CARNET_TEST,
        nombre: "Estudiante de Prueba (desmarcarCurso)",
        correo: `${CARNET_TEST}@test.una.ac.cr`,
        id_carrera: carreraIsi.id_carrera,
        password_hash: "no-aplica-en-este-test",
      },
    });
    idEstudiante = estudiante.id_estudiante;

    token = tokenPara(CARNET_TEST, carreraIsi.sigla);
  });

  afterAll(async () => {
    await prisma.estudiante.delete({ where: { carnet: CARNET_TEST } });
  });

  it("deshace un curso 'aprobado' -- caso ya existente, no debe romperse al generalizar", async () => {
    await prisma.historial_curso.create({
      data: { id_estudiante: idEstudiante, id_curso: idCurso, estado: "aprobado" },
    });

    const res = await request(app)
      .delete(`/api/estudiantes/${CARNET_TEST}/historial/${codigoCurso}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);

    const fila = await prisma.historial_curso.findUnique({
      where: { id_estudiante_id_curso: { id_estudiante: idEstudiante, id_curso: idCurso } },
    });
    expect(fila).toBeNull();
  });

  it("deshace un curso 'cursando' -- caso nuevo, generalización del DELETE", async () => {
    await prisma.historial_curso.create({
      data: { id_estudiante: idEstudiante, id_curso: idCurso, estado: "cursando" },
    });

    const res = await request(app)
      .delete(`/api/estudiantes/${CARNET_TEST}/historial/${codigoCurso}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);

    const fila = await prisma.historial_curso.findUnique({
      where: { id_estudiante_id_curso: { id_estudiante: idEstudiante, id_curso: idCurso } },
    });
    expect(fila).toBeNull();
  });

  it("es idempotente: sin fila de historial, responde 204 sin fallar", async () => {
    const res = await request(app)
      .delete(`/api/estudiantes/${CARNET_TEST}/historial/${codigoCurso}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);
  });

  it("responde 401 sin token", async () => {
    const res = await request(app).delete(
      `/api/estudiantes/${CARNET_TEST}/historial/${codigoCurso}`
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/estudiantes/:carnet/matricula", () => {
  let idEstudiante: number;
  let idCurso: number;
  let nrcReal: string;
  let token: string;

  beforeAll(async () => {
    const carreraIsi = await prisma.carrera.findUniqueOrThrow({
      where: { sigla: "isi" },
    });

    const periodoActivo = await prisma.periodo.findFirstOrThrow({
      where: { activo: true },
    });

    // Un curso de isi que además tenga sección ofertada en el período
    // activo -- si no existe ninguno, el fixture de datos cambió y el
    // test debe fallar ruidosamente, no saltarse en silencio.
    const cc = await prisma.curso_carrera.findFirstOrThrow({
      where: {
        id_carrera: carreraIsi.id_carrera,
        curso: {
          seccion: { some: { id_periodo: periodoActivo.id_periodo } },
        },
      },
      include: {
        curso: { include: { seccion: { where: { id_periodo: periodoActivo.id_periodo } } } },
      },
    });
    idCurso = cc.curso.id_curso;
    nrcReal = cc.curso.seccion[0].nrc;

    const estudiante = await prisma.estudiante.create({
      data: {
        carnet: `${CARNET_TEST}-MAT`,
        nombre: "Estudiante de Prueba (confirmarMatricula)",
        correo: `${CARNET_TEST}-mat@test.una.ac.cr`,
        id_carrera: carreraIsi.id_carrera,
        password_hash: "no-aplica-en-este-test",
      },
    });
    idEstudiante = estudiante.id_estudiante;

    token = tokenPara(`${CARNET_TEST}-MAT`, carreraIsi.sigla);
  });

  afterAll(async () => {
    await prisma.estudiante.delete({ where: { carnet: `${CARNET_TEST}-MAT` } });
  });

  it("confirma la matrícula: el curso queda 'cursando' con la sección real", async () => {
    const res = await request(app)
      .post(`/api/estudiantes/${CARNET_TEST}-MAT/matricula`)
      .set("Authorization", `Bearer ${token}`)
      .send({ nrcs: [nrcReal] });

    expect(res.status).toBe(204);

    const fila = await prisma.historial_curso.findUniqueOrThrow({
      where: { id_estudiante_id_curso: { id_estudiante: idEstudiante, id_curso: idCurso } },
    });
    expect(fila.estado).toBe("cursando");
    expect(fila.id_seccion).not.toBeNull();
  });

  it("responde 400 si el NRC no existe en el período activo", async () => {
    const res = await request(app)
      .post(`/api/estudiantes/${CARNET_TEST}-MAT/matricula`)
      .set("Authorization", `Bearer ${token}`)
      .send({ nrcs: ["00000"] });

    expect(res.status).toBe(400);
  });

  it("responde 400 si 'nrcs' no es un arreglo no vacío", async () => {
    const res = await request(app)
      .post(`/api/estudiantes/${CARNET_TEST}-MAT/matricula`)
      .set("Authorization", `Bearer ${token}`)
      .send({ nrcs: [] });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/estudiantes/:carnet/secciones-cursando", () => {
  let idEstudianteConSeccion: number;
  let idCurso: number;
  let codigoCurso: string;
  let nrcReal: string;
  let tokenConSeccion: string;

  let tokenSinSecciones: string;
  const CARNET_SIN_SECCIONES = `${CARNET_TEST}-VACIO`;
  const CARNET_CON_SECCION = `${CARNET_TEST}-HOR`;

  beforeAll(async () => {
    const carreraIsi = await prisma.carrera.findUniqueOrThrow({
      where: { sigla: "isi" },
    });

    const periodoActivo = await prisma.periodo.findFirstOrThrow({
      where: { activo: true },
    });

    // Mismo criterio que el describe de matrícula: un curso real de isi
    // con al menos una sección ofertada en el período activo.
    const cc = await prisma.curso_carrera.findFirstOrThrow({
      where: {
        id_carrera: carreraIsi.id_carrera,
        curso: {
          seccion: { some: { id_periodo: periodoActivo.id_periodo } },
        },
      },
      include: {
        curso: { include: { seccion: { where: { id_periodo: periodoActivo.id_periodo } } } },
      },
    });
    idCurso = cc.curso.id_curso;
    codigoCurso = cc.curso.codigo;
    nrcReal = cc.curso.seccion[0].nrc;

    const estudianteConSeccion = await prisma.estudiante.create({
      data: {
        carnet: CARNET_CON_SECCION,
        nombre: "Estudiante de Prueba (secciones-cursando, con sección)",
        correo: `${CARNET_CON_SECCION}@test.una.ac.cr`,
        id_carrera: carreraIsi.id_carrera,
        password_hash: "no-aplica-en-este-test",
      },
    });
    idEstudianteConSeccion = estudianteConSeccion.id_estudiante;

    const seccionReal = await prisma.seccion.findFirstOrThrow({ where: { nrc: nrcReal } });
    await prisma.historial_curso.create({
      data: {
        id_estudiante: idEstudianteConSeccion,
        id_curso: idCurso,
        estado: "cursando",
        id_seccion: seccionReal.id_seccion,
        id_periodo: periodoActivo.id_periodo,
      },
    });

    await prisma.estudiante.create({
      data: {
        carnet: CARNET_SIN_SECCIONES,
        nombre: "Estudiante de Prueba (secciones-cursando, sin secciones)",
        correo: `${CARNET_SIN_SECCIONES}@test.una.ac.cr`,
        id_carrera: carreraIsi.id_carrera,
        password_hash: "no-aplica-en-este-test",
      },
    });

    tokenConSeccion = tokenPara(CARNET_CON_SECCION, carreraIsi.sigla);
    tokenSinSecciones = tokenPara(CARNET_SIN_SECCIONES, carreraIsi.sigla);
  });

  afterAll(async () => {
    await prisma.estudiante.delete({ where: { carnet: CARNET_CON_SECCION } });
    await prisma.estudiante.delete({ where: { carnet: CARNET_SIN_SECCIONES } });
  });

  it("devuelve la sección real del curso 'cursando', con curso/profesor/horarios resueltos", async () => {
    const res = await request(app)
      .get(`/api/estudiantes/${CARNET_CON_SECCION}/secciones-cursando`)
      .set("Authorization", `Bearer ${tokenConSeccion}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const seccion = res.body[0];
    expect(seccion.nrc).toBe(nrcReal);
    expect(seccion.codigoCurso).toBe(codigoCurso);
    expect(typeof seccion.titulo).toBe("string");
    expect(seccion.titulo.length).toBeGreaterThan(0);
    expect(Array.isArray(seccion.horarios)).toBe(true);
    // profesor puede venir "" si la sección real no tiene profesor
    // asignado en los datos de prueba -- el campo debe existir igual.
    expect(typeof seccion.profesor).toBe("string");
  });

  it("responde un array vacío si el estudiante no tiene ninguna sección confirmada", async () => {
    const res = await request(app)
      .get(`/api/estudiantes/${CARNET_SIN_SECCIONES}/secciones-cursando`)
      .set("Authorization", `Bearer ${tokenSinSecciones}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("responde 403 si el carnet de la URL no coincide con el del JWT", async () => {
    const res = await request(app)
      .get(`/api/estudiantes/${CARNET_SIN_SECCIONES}/secciones-cursando`)
      .set("Authorization", `Bearer ${tokenConSeccion}`);

    expect(res.status).toBe(403);
  });

  it("responde 401 sin token", async () => {
    const res = await request(app).get(
      `/api/estudiantes/${CARNET_CON_SECCION}/secciones-cursando`
    );
    expect(res.status).toBe(401);
  });
});

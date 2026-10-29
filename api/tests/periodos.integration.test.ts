import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

/**
 * Tests de integración multi-período contra la BD real (horarios-db).
 *
 * Fixtures: dos períodos ficticios activos (209910, 209920) y uno
 * inactivo (209930), con secciones ficticias de cursos REALES de isi.
 * Como 209910 > 202620, el período predeterminado sigue siendo el real
 * (202620) mientras corren -- los datos reales no cambian de default.
 *
 * El mismo NRC (99001) existe en los dos períodos con cursos distintos,
 * para probar que todo lo que resuelve por NRC filtra por período.
 *
 * La limpieza es idempotente (deleteMany) y corre en afterAll aunque un
 * test o el propio beforeAll fallen; también se corre al inicio por si
 * quedó basura de una corrida anterior interrumpida.
 */

const app = createApp();

const P1 = "209910";
const P2 = "209920";
const P_INACTIVO = "209930";
const CODIGOS_TEST = [P1, P2, P_INACTIVO];
const CARNET = "TEST-PER-999";

function tokenPara(carnet: string, carreraSigla: string): string {
  return jwt.sign({ carnet, carreraSigla }, process.env.JWT_SECRET!, { expiresIn: "1h" });
}

async function limpiar() {
  await prisma.estudiante.deleteMany({ where: { carnet: CARNET } });
  // horario_bloque cae por onDelete: Cascade de seccion.
  await prisma.seccion.deleteMany({ where: { periodo: { codigo: { in: CODIGOS_TEST } } } });
  await prisma.periodo.deleteMany({ where: { codigo: { in: CODIGOS_TEST } } });
}

describe("Soporte multi-período", () => {
  let token: string;
  let idEstudiante: number;
  // Curso A con un único prerrequisito directo P (en la malla de isi).
  let cursoA: { id_curso: number; codigo: string };
  let cursoP: { id_curso: number; codigo: string };
  let idP1: number;
  let idP2: number;
  let idPInactivo: number;

  async function crearSeccion(
    nrc: string,
    idPeriodo: number,
    curso: { id_curso: number; codigo: string },
    dia: string
  ) {
    await prisma.seccion.create({
      data: {
        nrc,
        id_periodo: idPeriodo,
        id_curso: curso.id_curso,
        codigo_curso_banner: curso.codigo,
        numero_seccion: "01",
        titulo: `Sección de prueba ${curso.codigo}`,
        metadata: { banner_program: "isi" },
        horario_bloque: {
          create: {
            dia,
            hora_inicio: new Date("1970-01-01T08:00:00Z"),
            hora_fin: new Date("1970-01-01T09:40:00Z"),
            aula: "TEST",
          },
        },
      },
    });
  }

  async function setHistorial(curso: { id_curso: number }, estado: string, idPeriodo: number | null) {
    await prisma.historial_curso.deleteMany({
      where: { id_estudiante: idEstudiante, id_curso: curso.id_curso },
    });
    if (estado === "ninguno") return;
    await prisma.historial_curso.create({
      data: { id_estudiante: idEstudiante, id_curso: curso.id_curso, estado, id_periodo: idPeriodo },
    });
  }

  async function oferta(periodo?: string) {
    const url = `/api/estudiantes/${CARNET}/oferta${periodo ? `?periodo=${periodo}` : ""}`;
    const res = await request(app).get(url).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as Array<{
      codigo: string;
      estado: string;
      prerrequisitosFaltantes: { code: string; enCurso: boolean }[];
      periodoCursando: { codigo: string } | null;
    }>;
  }

  beforeAll(async () => {
    await limpiar();

    const isi = await prisma.carrera.findUniqueOrThrow({ where: { sigla: "isi" } });

    // Un curso de la malla de isi con EXACTAMENTE un prerrequisito directo
    // (scoped a isi o sin carrera), para que "aprobar P" lo vuelva elegible.
    const prereqs = await prisma.prerrequisito.findMany({
      where: {
        tipo: "prerequisito",
        OR: [{ id_carrera: null }, { id_carrera: isi.id_carrera }],
        curso: { es_general: false, curso_carrera: { some: { id_carrera: isi.id_carrera } } },
      },
      include: { curso: true, cursoRequerido: true },
    });
    const porCurso = new Map<number, typeof prereqs>();
    for (const p of prereqs) porCurso.set(p.id_curso, [...(porCurso.get(p.id_curso) ?? []), p]);
    // ...y cuyo prerrequisito P no tenga prerrequisitos propios, porque
    // algunos tests matriculan P directamente con un historial vacío.
    const todosLosConPrereq = new Set(
      (await prisma.prerrequisito.findMany({
        where: { tipo: "prerequisito", OR: [{ id_carrera: null }, { id_carrera: isi.id_carrera }] },
        select: { id_curso: true },
      })).map((p) => p.id_curso)
    );
    const unico = [...porCurso.values()].find(
      (lista) => lista.length === 1 && !todosLosConPrereq.has(lista[0].id_curso_requerido)
    );
    expect(unico).toBeDefined(); // fixture real: si cambia, debe fallar ruidoso
    cursoA = unico![0].curso;
    cursoP = unico![0].cursoRequerido;

    idP1 = (await prisma.periodo.create({
      data: { codigo: P1, nombre: "TEST Ciclo I 2099", anio: 2099, ciclo: 1, activo: true },
    })).id_periodo;
    idP2 = (await prisma.periodo.create({
      data: { codigo: P2, nombre: "TEST Ciclo II 2099", anio: 2099, ciclo: 2, activo: true },
    })).id_periodo;
    idPInactivo = (await prisma.periodo.create({
      data: { codigo: P_INACTIVO, nombre: "TEST Inactivo 2099", anio: 2099, ciclo: 3, activo: false },
    })).id_periodo;

    // Mismo NRC 99001 en ambos períodos, con cursos distintos.
    await crearSeccion("99001", idP1, cursoA, "Lunes");
    await crearSeccion("99002", idP1, cursoP, "Martes");
    await crearSeccion("99001", idP2, cursoP, "Miércoles");
    await crearSeccion("99003", idP2, cursoA, "Jueves");

    idEstudiante = (await prisma.estudiante.create({
      data: {
        carnet: CARNET,
        nombre: "Estudiante de Prueba (multi-período)",
        correo: `${CARNET}@test.una.ac.cr`,
        id_carrera: isi.id_carrera,
        password_hash: "no-aplica-en-este-test",
      },
    })).id_estudiante;
    token = tokenPara(CARNET, isi.sigla);
  });

  afterAll(async () => {
    await limpiar();
  });

  describe("GET /api/periodos y período predeterminado", () => {
    it("lista los activos ordenados por código y marca como predeterminado el de código más bajo", async () => {
      const res = await request(app).get("/api/periodos");
      expect(res.status).toBe(200);

      const codigos = res.body.map((p: { codigo: string }) => p.codigo);
      expect(codigos).toEqual([...codigos].sort((a, b) => Number(a) - Number(b)));
      expect(codigos).toContain(P1);
      expect(codigos).toContain(P2);
      expect(codigos).not.toContain(P_INACTIVO);

      const predeterminados = res.body.filter((p: { esPredeterminado: boolean }) => p.esPredeterminado);
      expect(predeterminados).toHaveLength(1);
      expect(predeterminados[0].codigo).toBe(codigos[0]);
      expect(Number(codigos[0])).toBeLessThan(Number(P1)); // el real (202620) sigue siendo default
    });

    it("sin ?periodo, la oferta es la del predeterminado", async () => {
      const lista = await request(app).get("/api/periodos");
      const predeterminado = lista.body.find((p: { esPredeterminado: boolean }) => p.esPredeterminado);
      expect(await oferta()).toEqual(await oferta(predeterminado.codigo));
    });

    it("con ?periodo, la oferta trae solo las secciones de ese período", async () => {
      const ofertaP1 = await oferta(P1);
      expect(ofertaP1.map((c) => c.codigo).sort()).toEqual([cursoA.codigo, cursoP.codigo].sort());
    });
  });

  describe("?periodo inválido -> 400", () => {
    it.each([
      ["inexistente", "190010"],
      ["inactivo", P_INACTIVO],
    ])("período %s", async (_caso, codigo) => {
      const rutas = [
        request(app).get(`/api/estudiantes/${CARNET}/oferta?periodo=${codigo}`).set("Authorization", `Bearer ${token}`),
        request(app).get(`/api/estudiantes/${CARNET}/secciones-cursando?periodo=${codigo}`).set("Authorization", `Bearer ${token}`),
        request(app).post(`/api/estudiantes/${CARNET}/matricula?periodo=${codigo}`).set("Authorization", `Bearer ${token}`).send({ nrcs: ["99001"] }),
        request(app).get(`/api/horarios/secciones/${cursoA.codigo}?periodo=${codigo}`),
        request(app).get(`/api/horarios/nrc/99001?periodo=${codigo}`),
        request(app).post(`/api/horarios/validar?periodo=${codigo}`).send({ nrcs: ["99001"] }),
      ];
      for (const res of await Promise.all(rutas)) {
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
      }
    });
  });

  describe("mismo NRC en dos períodos", () => {
    it("GET /horarios/nrc/:nrc resuelve la sección del período pedido", async () => {
      const r1 = await request(app).get(`/api/horarios/nrc/99001?periodo=${P1}`);
      const r2 = await request(app).get(`/api/horarios/nrc/99001?periodo=${P2}`);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r1.body.codigoCurso).toBe(cursoA.codigo);
      expect(r2.body.codigoCurso).toBe(cursoP.codigo);
    });

    it("GET /horarios/secciones/:codigo filtra por período", async () => {
      const r1 = await request(app).get(`/api/horarios/secciones/${cursoA.codigo}?periodo=${P1}`);
      const r2 = await request(app).get(`/api/horarios/secciones/${cursoA.codigo}?periodo=${P2}`);
      expect(r1.body.map((s: { nrc: string }) => s.nrc)).toEqual(["99001"]);
      expect(r2.body.map((s: { nrc: string }) => s.nrc)).toEqual(["99003"]);
    });

    it("POST /horarios/validar solo ve los NRC del período pedido", async () => {
      const ok = await request(app).post(`/api/horarios/validar?periodo=${P1}`).send({ nrcs: ["99001", "99002"] });
      expect(ok.status).toBe(200);
      expect(ok.body.tieneConflictos).toBe(false);

      const fuera = await request(app).post(`/api/horarios/validar?periodo=${P1}`).send({ nrcs: ["99003"] });
      expect(fuera.status).toBe(400);
      expect(fuera.body.missingNrcs).toEqual(["99003"]);
    });

    it("una sección sin horario publicado no rompe la validación de conflictos", async () => {
      // Típico de ciclos futuros (202710/202720): Banner publica la sección
      // antes que sus bloques.
      await prisma.seccion.create({
        data: {
          nrc: "99004",
          id_periodo: idP2,
          id_curso: cursoA.id_curso,
          codigo_curso_banner: cursoA.codigo,
          numero_seccion: "02",
          metadata: { banner_program: "isi" },
        },
      });
      const res = await request(app)
        .post(`/api/horarios/validar?periodo=${P2}`)
        .send({ nrcs: ["99004", "99001"] });
      expect(res.status).toBe(200);
      expect(res.body.tieneConflictos).toBe(false);

      const nrc = await request(app).get(`/api/horarios/nrc/99004?periodo=${P2}`);
      expect(nrc.status).toBe(200);
      expect(nrc.body.horarios).toEqual([]);
    });

    it("la matrícula guarda la sección y el período pedidos", async () => {
      await setHistorial(cursoA, "ninguno", null);
      await setHistorial(cursoP, "ninguno", null);

      const res = await request(app)
        .post(`/api/estudiantes/${CARNET}/matricula?periodo=${P2}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ nrcs: ["99001"] }); // en P2, 99001 es el curso P (sin prerrequisitos en este fixture)
      expect(res.status).toBe(204);

      const fila = await prisma.historial_curso.findUniqueOrThrow({
        where: { id_estudiante_id_curso: { id_estudiante: idEstudiante, id_curso: cursoP.id_curso } },
        include: { seccion: true },
      });
      expect(fila.estado).toBe("cursando");
      expect(fila.id_periodo).toBe(idP2);
      expect(fila.seccion?.id_periodo).toBe(idP2);

      const horario = await request(app)
        .get(`/api/estudiantes/${CARNET}/secciones-cursando?periodo=${P2}`)
        .set("Authorization", `Bearer ${token}`);
      expect(horario.body.map((s: { codigoCurso: string }) => s.codigoCurso)).toEqual([cursoP.codigo]);

      const horarioOtro = await request(app)
        .get(`/api/estudiantes/${CARNET}/secciones-cursando?periodo=${P1}`)
        .set("Authorization", `Bearer ${token}`);
      expect(horarioOtro.body).toEqual([]);
    });
  });

  describe("elegibilidad independiente del período", () => {
    it("prerrequisito 'cursando' -> curso Bloqueado en TODOS los períodos, con el faltante marcado enCurso", async () => {
      await setHistorial(cursoA, "ninguno", null);
      await setHistorial(cursoP, "cursando", idP1);

      for (const periodo of [P1, P2]) {
        const a = (await oferta(periodo)).find((c) => c.codigo === cursoA.codigo)!;
        expect(a.estado).toBe("bloqueado");
        expect(a.prerrequisitosFaltantes).toEqual([
          expect.objectContaining({ code: cursoP.codigo, enCurso: true }),
        ]);
      }
    });

    it("prerrequisito 'aprobado' -> curso Elegible en TODOS los períodos", async () => {
      await setHistorial(cursoA, "ninguno", null);
      await setHistorial(cursoP, "aprobado", null);

      for (const periodo of [P1, P2]) {
        const a = (await oferta(periodo)).find((c) => c.codigo === cursoA.codigo)!;
        expect(a.estado).toBe("elegible");
        expect(a.prerrequisitosFaltantes).toEqual([]);
      }
    });

    it("un curso 'cursando' se ve Cursando en todos los períodos, con su período", async () => {
      await setHistorial(cursoP, "cursando", idP1);
      for (const periodo of [P1, P2]) {
        const p = (await oferta(periodo)).find((c) => c.codigo === cursoP.codigo)!;
        expect(p.estado).toBe("cursando");
        expect(p.periodoCursando?.codigo).toBe(P1);
      }
    });
  });

  describe("matrícula rechazada por elegibilidad", () => {
    it("rechaza (409) un curso ya 'cursando' en otro período, sin tocar el historial", async () => {
      await setHistorial(cursoA, "ninguno", null);
      await setHistorial(cursoP, "cursando", idP1);

      const res = await request(app)
        .post(`/api/estudiantes/${CARNET}/matricula?periodo=${P2}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ nrcs: ["99001"] }); // curso P en P2
      expect(res.status).toBe(409);

      const fila = await prisma.historial_curso.findUniqueOrThrow({
        where: { id_estudiante_id_curso: { id_estudiante: idEstudiante, id_curso: cursoP.id_curso } },
      });
      expect(fila.id_periodo).toBe(idP1);
    });

    it("permite cambiar de sección de un curso 'cursando' en el MISMO período", async () => {
      await setHistorial(cursoP, "cursando", idP1);
      const res = await request(app)
        .post(`/api/estudiantes/${CARNET}/matricula?periodo=${P1}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ nrcs: ["99002"] }); // curso P en P1
      expect(res.status).toBe(204);
    });

    it("rechaza (409) un curso con prerrequisito faltante aunque esté 'cursando'", async () => {
      await setHistorial(cursoA, "ninguno", null);
      await setHistorial(cursoP, "cursando", idP1);

      const res = await request(app)
        .post(`/api/estudiantes/${CARNET}/matricula?periodo=${P2}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ nrcs: ["99003"] }); // curso A en P2
      expect(res.status).toBe(409);
      expect(res.body.error).toContain(cursoP.codigo);
    });

    it("rechaza (409) un curso ya 'aprobado'", async () => {
      await setHistorial(cursoP, "aprobado", null);
      const res = await request(app)
        .post(`/api/estudiantes/${CARNET}/matricula?periodo=${P1}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ nrcs: ["99002"] });
      expect(res.status).toBe(409);

      const fila = await prisma.historial_curso.findUniqueOrThrow({
        where: { id_estudiante_id_curso: { id_estudiante: idEstudiante, id_curso: cursoP.id_curso } },
      });
      expect(fila.estado).toBe("aprobado");
    });
  });

  describe("Mi Horario con un ciclo finalizado (inactivo)", () => {
    async function periodosHorario() {
      const res = await request(app)
        .get(`/api/estudiantes/${CARNET}/periodos-horario`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      return res.body as { codigo: string; esPredeterminado: boolean; finalizado: boolean }[];
    }

    async function cursandoEnInactivo() {
      await setHistorial(cursoA, "ninguno", null);
      const seccion = await prisma.seccion.create({
        data: {
          nrc: "99005",
          id_periodo: idPInactivo,
          id_curso: cursoA.id_curso,
          codigo_curso_banner: cursoA.codigo,
          numero_seccion: "01",
          metadata: { banner_program: "isi" },
        },
      });
      await prisma.historial_curso.create({
        data: {
          id_estudiante: idEstudiante,
          id_curso: cursoA.id_curso,
          estado: "cursando",
          id_periodo: idPInactivo,
          id_seccion: seccion.id_seccion,
        },
      });
    }

    async function limpiarInactivo() {
      await setHistorial(cursoA, "ninguno", null);
      await prisma.seccion.deleteMany({ where: { id_periodo: idPInactivo } });
    }

    it("con 'cursando' en el ciclo inactivo, Mi Horario lo ofrece como finalizado y muestra su horario", async () => {
      await cursandoEnInactivo();
      try {
        const periodos = await periodosHorario();
        const inactivo = periodos.find((p) => p.codigo === P_INACTIVO);
        expect(inactivo).toEqual(expect.objectContaining({ finalizado: true, esPredeterminado: false }));
        expect(periodos.filter((p) => p.esPredeterminado)).toHaveLength(1);
        expect(periodos.filter((p) => p.finalizado).map((p) => p.codigo)).toEqual([P_INACTIVO]);

        const horario = await request(app)
          .get(`/api/estudiantes/${CARNET}/secciones-cursando?periodo=${P_INACTIVO}`)
          .set("Authorization", `Bearer ${token}`);
        expect(horario.status).toBe(200);
        expect(horario.body.map((s: { nrc: string }) => s.nrc)).toEqual(["99005"]);

        // Mis Cursos no cambia: la oferta de un ciclo inactivo sigue siendo 400.
        const oferta = await request(app)
          .get(`/api/estudiantes/${CARNET}/oferta?periodo=${P_INACTIVO}`)
          .set("Authorization", `Bearer ${token}`);
        expect(oferta.status).toBe(400);
        const publicos = await request(app).get("/api/periodos");
        expect(publicos.body.map((p: { codigo: string }) => p.codigo)).not.toContain(P_INACTIVO);
      } finally {
        await limpiarInactivo();
      }
    });

    it("sin 'cursando' en el ciclo inactivo, no aparece y secciones-cursando responde 400", async () => {
      await limpiarInactivo();
      expect((await periodosHorario()).map((p) => p.codigo)).not.toContain(P_INACTIVO);

      const horario = await request(app)
        .get(`/api/estudiantes/${CARNET}/secciones-cursando?periodo=${P_INACTIVO}`)
        .set("Authorization", `Bearer ${token}`);
      expect(horario.status).toBe(400);
    });
  });
});

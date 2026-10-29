import type { PrismaClient, Prisma } from "@prisma/client";
import {
  getDirectPrerequisitesForCourses,
  type PrerequisiteRef,
} from "./prerrequisito.service";

/**
 * Única fuente de verdad de la elegibilidad de un curso para un
 * estudiante. La usan la oferta (getOfertaCiclo) y la matrícula
 * (confirmarMatricula), para que lo que la UI muestra como Elegible y lo
 * que el backend acepta matricular no puedan divergir.
 *
 * Reglas (decisión de diseño multi-período):
 * - Solo historial_curso.estado='aprobado' cumple un prerrequisito.
 *   'cursando' NUNCA lo cumple, sea del período que sea.
 * - Por eso la elegibilidad NO depende del período que se esté viendo:
 *   depende solo de lo que el estudiante marcó en su historial. Lo único
 *   que cambia entre períodos es qué secciones existen.
 * - Un curso 'cursando' se ve como Cursando en cualquier período, con el
 *   período en que está matriculado (periodoCursando).
 *
 * Los topes de Generales/Optativas NO viven acá (son del plan, no de
 * prerrequisitos, y siguen en estudiante.service.ts).
 */

type Client = PrismaClient | Prisma.TransactionClient;

export type EligibilityStatus = "aprobado" | "cursando" | "elegible" | "bloqueado";

export interface PeriodRef {
  codigo: string;
  nombre: string;
}

export interface MissingPrerequisite extends PrerequisiteRef {
  /** true si el prerrequisito faltante está 'cursando': el estudiante
   * debe marcarlo como aprobado en la Malla cuando lo apruebe. */
  enCurso: boolean;
}

export interface CourseEligibility {
  estado: EligibilityStatus;
  /** Solo no-vacío cuando estado === "bloqueado". */
  prerrequisitosFaltantes: MissingPrerequisite[];
  /** Solo presente cuando estado === "cursando" y la fila tiene período. */
  periodoCursando: PeriodRef | null;
}

/** Fila mínima de historial que necesita el cálculo. */
export interface EligibilityHistoryRow {
  id_curso: number;
  estado: string;
  curso: { codigo: string };
  periodo: PeriodRef | null;
}

export interface EligibilityContext {
  historialPorCurso: Map<number, EligibilityHistoryRow>;
  estadoPorCodigo: Map<string, string>;
  prerrequisitosPorCurso: Map<number, PrerequisiteRef[]>;
}

/**
 * Arma el contexto a partir de un historial ya cargado (para quien ya
 * lo necesita con más includes, ej. getOfertaCiclo) y los cursos a evaluar.
 */
export async function buildEligibilityContext(
  client: Client,
  historial: EligibilityHistoryRow[],
  courseIds: number[],
  careerId: number
): Promise<EligibilityContext> {
  return {
    historialPorCurso: new Map(historial.map((h) => [h.id_curso, h])),
    estadoPorCodigo: new Map(historial.map((h) => [h.curso.codigo, h.estado])),
    prerrequisitosPorCurso: await getDirectPrerequisitesForCourses(courseIds, careerId, client),
  };
}

/** Carga historial + prerrequisitos y arma el contexto en un paso. */
export async function loadEligibilityContext(
  client: Client,
  idEstudiante: number,
  careerId: number,
  courseIds: number[]
): Promise<EligibilityContext> {
  const historial = await client.historial_curso.findMany({
    where: { id_estudiante: idEstudiante },
    include: { curso: true, periodo: true },
  });
  return buildEligibilityContext(client, historial, courseIds, careerId);
}

/** Estado de elegibilidad de un curso según el contexto ya cargado. */
export function evaluateCourse(ctx: EligibilityContext, idCurso: number): CourseEligibility {
  const fila = ctx.historialPorCurso.get(idCurso);

  if (fila?.estado === "aprobado") {
    return { estado: "aprobado", prerrequisitosFaltantes: [], periodoCursando: null };
  }
  if (fila?.estado === "cursando") {
    return {
      estado: "cursando",
      prerrequisitosFaltantes: [],
      periodoCursando: fila.periodo
        ? { codigo: fila.periodo.codigo, nombre: fila.periodo.nombre }
        : null,
    };
  }

  // Sin fila (o 'pendiente'): se evalúan los prerrequisitos DIRECTOS.
  const faltantes: MissingPrerequisite[] = (ctx.prerrequisitosPorCurso.get(idCurso) ?? [])
    .filter((p) => ctx.estadoPorCodigo.get(p.code) !== "aprobado")
    .map((p) => ({ ...p, enCurso: ctx.estadoPorCodigo.get(p.code) === "cursando" }));

  return {
    estado: faltantes.length > 0 ? "bloqueado" : "elegible",
    prerrequisitosFaltantes: faltantes,
    periodoCursando: null,
  };
}

import type { periodo } from "@prisma/client";
import { prisma } from "../db";

/**
 * El cliente pidió un período que no existe o que no está activo
 * (no seleccionable). La ruta lo traduce a 400.
 */
export class PeriodoInvalidoError extends Error {}

/**
 * No hay ningún período activo en la BD: error de datos/configuración,
 * no del cliente. La ruta lo traduce a 500. El ETL mantiene el
 * invariante de nunca dejar 0 activos, así que esto no debería pasar.
 */
export class SinPeriodosActivosError extends Error {}

export interface PeriodoResumen {
  codigo: string;
  nombre: string;
  esPredeterminado: boolean;
}

/**
 * Períodos activos ordenados cronológicamente. Los códigos YYYYNN
 * (ej. 202620, 202695, 202710) ordenan bien como enteros.
 */
async function findActivePeriods(): Promise<periodo[]> {
  const activos = await prisma.periodo.findMany({ where: { activo: true } });
  return activos.sort((a, b) => Number(a.codigo) - Number(b.codigo));
}

/**
 * Lista de períodos seleccionables para GET /api/periodos. El
 * predeterminado es el activo de código más bajo (el que está en curso).
 */
export async function listActivePeriods(): Promise<PeriodoResumen[]> {
  const activos = await findActivePeriods();
  return activos.map((p, i) => ({
    codigo: p.codigo,
    nombre: p.nombre,
    esPredeterminado: i === 0,
  }));
}

/**
 * Única forma de resolver "con qué período trabaja este request".
 * - Sin código: el período predeterminado (activo de código más bajo).
 * - Con código: debe existir y estar activo; si no, PeriodoInvalidoError.
 */
export async function resolvePeriod(codigo?: string): Promise<periodo> {
  if (codigo === undefined) {
    const [predeterminado] = await findActivePeriods();
    if (!predeterminado) {
      throw new SinPeriodosActivosError("No hay ningún período activo configurado");
    }
    return predeterminado;
  }

  const encontrado = await prisma.periodo.findUnique({ where: { codigo } });
  if (!encontrado || !encontrado.activo) {
    throw new PeriodoInvalidoError(`El período ${codigo} no existe o no está disponible`);
  }
  return encontrado;
}

/** Período del horario de un estudiante: activo o finalizado con matrícula. */
export interface PeriodoHorario extends PeriodoResumen {
  /** true si el período ya no está activo: solo lectura en Mi Horario. */
  finalizado: boolean;
}

/**
 * Períodos que Mi Horario le muestra a un estudiante: los activos (igual
 * que listActivePeriods) más los INACTIVOS donde todavía tiene cursos
 * 'cursando' -- un ciclo que terminó no debe esconder el horario del que
 * el estudiante aún no marcó resultados. Mis Cursos sigue usando solo los
 * activos (listActivePeriods).
 */
export async function listSchedulePeriods(idEstudiante: number): Promise<PeriodoHorario[]> {
  const activos = await listActivePeriods();
  const finalizados = await prisma.periodo.findMany({
    where: {
      activo: false,
      historial_curso: { some: { id_estudiante: idEstudiante, estado: "cursando" } },
    },
  });
  return [
    ...activos.map((p) => ({ ...p, finalizado: false })),
    ...finalizados.map((p) => ({
      codigo: p.codigo,
      nombre: p.nombre,
      esPredeterminado: false,
      finalizado: true,
    })),
  ].sort((a, b) => Number(a.codigo) - Number(b.codigo));
}

/**
 * Hermana de resolvePeriod para Mi Horario: mismas reglas, y además acepta
 * un período INACTIVO solo si el estudiante tiene 'cursando' en él. Si no,
 * PeriodoInvalidoError (400), igual que resolvePeriod.
 */
export async function resolveSchedulePeriod(
  codigo: string | undefined,
  idEstudiante: number
): Promise<periodo> {
  try {
    return await resolvePeriod(codigo);
  } catch (err) {
    if (!(err instanceof PeriodoInvalidoError) || codigo === undefined) throw err;
    const finalizado = await prisma.periodo.findFirst({
      where: {
        codigo,
        activo: false,
        historial_curso: { some: { id_estudiante: idEstudiante, estado: "cursando" } },
      },
    });
    if (!finalizado) throw err;
    return finalizado;
  }
}

/**
 * Lee el query param ?periodo de un request de Express. Ausente o vacío
 * equivale a "usar el predeterminado"; repetido (?periodo=a&periodo=b)
 * o con otro tipo es un error del cliente.
 */
export function readPeriodQuery(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") {
    throw new PeriodoInvalidoError("El parámetro 'periodo' debe ser un único código");
  }
  return value.trim();
}

/** Período resumido para incluir en respuestas de otros endpoints. */
export function toPeriodRef(p: { codigo: string; nombre: string }): {
  codigo: string;
  nombre: string;
} {
  return { codigo: p.codigo, nombre: p.nombre };
}

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

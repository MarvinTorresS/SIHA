import { prisma } from "../db";
import {
  validateSchedule,
  type SectionSchedule,
  type ValidationResult,
} from "./conflicto.service";

/**
 * Error lanzado cuando uno o más NRCs enviados no existen en la BD.
 * La ruta decide el status HTTP (400 o 404) al capturarlo.
 */
export class NrcNotFoundError extends Error {
  public readonly missingNrcs: string[];

  constructor(missingNrcs: string[]) {
    super(`NRC(s) no encontrado(s): ${missingNrcs.join(", ")}`);
    this.name = "NrcNotFoundError";
    this.missingNrcs = missingNrcs;
  }
}

/**
 * Convierte un valor DateTime de Prisma (columna TIME de Postgres,
 * mapeada internamente a una fecha base como 1970-01-01) al formato
 * "HH:MM" que espera conflicto.service.ts.
 *
 * Se usan los getters UTC porque Prisma devuelve las columnas TIME
 * sin zona horaria como UTC internamente; usar getHours()/getMinutes()
 * locales podría desplazar la hora según la zona horaria del proceso
 * que corre la API.
 */
function timeToHourString(value: Date): string {
  const hours = value.getUTCHours().toString().padStart(2, "0");
  const minutes = value.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Busca las secciones correspondientes a una lista de NRCs y arma la
 * estructura de bloques horarios que espera el ConflictDetector.
 *
 * Lanza NrcNotFoundError si algún NRC de la lista no existe en la BD
 * (se rechaza la validación completa en vez de validar parcialmente).
 *
 * Nota: nrc no es único por sí solo en el esquema (uq_seccion_nrc_periodo
 * es la combinación nrc + id_periodo), así que si en el futuro se
 * necesita filtrar por período específico, agregar ese filtro aquí.
 * Por ahora se asume un solo período activo relevante para la validación.
 */
export async function getSectionSchedulesByNrc(
  nrcs: string[]
): Promise<SectionSchedule[]> {
  const sections = await prisma.seccion.findMany({
    where: { nrc: { in: nrcs } },
    include: { horario_bloque: true },
  });

  const foundNrcs = new Set(sections.map((s) => s.nrc));
  const missingNrcs = nrcs.filter((nrc) => !foundNrcs.has(nrc));

  if (missingNrcs.length > 0) {
    throw new NrcNotFoundError(missingNrcs);
  }

  return sections.map((section) => ({
    codigoCurso: section.codigo_curso_banner,
    nrc: section.nrc,
    bloques: section.horario_bloque.map((block) => ({
      dia: block.dia,
      horaInicio: timeToHourString(block.hora_inicio),
      horaFin: timeToHourString(block.hora_fin),
    })),
  }));
}

/**
 * Punto de entrada para el endpoint POST /api/horarios/validar.
 * Recibe una lista de NRCs (sección ya asignada institucionalmente o
 * elegida manualmente por el estudiante para optativos/adelantos),
 * resuelve sus bloques horarios reales contra la BD, y valida
 * conflictos usando el ConflictDetector puro.
 */
export async function validateScheduleByNrc(
  nrcs: string[]
): Promise<ValidationResult> {
  const sections = await getSectionSchedulesByNrc(nrcs);
  return validateSchedule(sections);
}
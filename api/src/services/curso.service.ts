import { prisma } from "../db";

/**
 * Filtros opcionales para listar cursos.
 * idCarrera y cicloId corresponden a las columnas id_carrera y
 * ciclo_id de la tabla `curso` (nombres de columna se dejan en
 * español porque vienen del esquema real de PostgreSQL).
 */
export interface CourseFilters {
  idCarrera?: number;
  cicloId?: string;
}

/**
 * Lista todos los cursos, opcionalmente filtrados por carrera o ciclo.
 * Corresponde a GET /api/cursos (con query params opcionales).
 *
 * Nota: si idCarrera o cicloId vienen como `undefined`, Prisma ignora
 * ese campo del `where` (no filtra por él). La ruta es responsable de
 * convertir un query param vacío/ausente en `undefined` antes de
 * llamar a esta función -- ver curso.routes.ts.
 */
export async function listCourses(filters: CourseFilters) {
  return prisma.curso.findMany({
    where: {
      id_carrera: filters.idCarrera,
      ciclo_id: filters.cicloId,
    },
    include: {
      carrera: true,
    },
    orderBy: {
      codigo: "asc",
    },
  });
}

/**
 * Busca un curso por su código exacto (ej. "EIF207").
 * Corresponde a GET /api/cursos/{codigo}.
 * Devuelve null si no existe -- la ruta decide qué status HTTP usar.
 */
export async function findCourseByCode(code: string) {
  return prisma.curso.findUnique({
    where: { codigo: code },
    include: {
      carrera: true,
    },
  });
}

/**
 * Lista los cursos de una carrera específica por su id.
 * Corresponde a GET /api/cursos/carrera/{id}.
 * No incluye `carrera` en el resultado: quien llama ya conoce el id
 * de la carrera por la URL, así que repetirlo en cada curso sería
 * redundante.
 */
export async function listCoursesByProgram(idCarrera: number) {
  return prisma.curso.findMany({
    where: { id_carrera: idCarrera },
    orderBy: { codigo: "asc" },
  });
}
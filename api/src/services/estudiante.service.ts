import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// -----------------------------------------------------------------------
// Tipos de salida del endpoint GET /api/estudiantes/:carnet/malla-progreso
// -----------------------------------------------------------------------

export type EstadoCursoProgreso =
  | "aprobado"
  | "cursando"
  | "sin_seccion"
  | "pendiente";

export interface HorarioBloqueInfo {
  dia: string;
  horaInicio: string; // formateado HH:MM, no el objeto Date que devuelve Prisma
  horaFin: string;
  aula: string;
}

export interface SeccionInfo {
  nrc: string;
  numeroSeccion: string;
  profesor: string | null;
  horarios: HorarioBloqueInfo[];
}

export interface CursoConProgreso {
  idCurso: number;
  codigo: string;
  nombre: string;
  creditos: string; // se deja como string, igual que el resto de la API (Decimal serializado)
  cicloId: string;
  cicloNombre: string;
  esOptativo: boolean;
  estado: EstadoCursoProgreso;
  nota: string | null;
  // Solo presente cuando historial_curso.id_seccion no es null (típicamente
  // en estado "cursando"). null en cualquier otro caso -- no se inventa
  // una sección para cursos aprobados históricos sin ese dato, ni para
  // pendiente/sin_seccion, que por definición no tienen sección propia.
  seccion: SeccionInfo | null;
}

export interface SemestreProgreso {
  cicloId: string;
  cicloNombre: string;
  cursos: CursoConProgreso[];
}


export interface MallaProgresoResponse {
  estudiante: {
    carnet: string;
    nombre: string;
    cicloActualId: string;
  };
  carrera: {
    idCarrera: number;
    sigla: string;
    nombre: string;
  };
  resumen: {
    creditosTotalesCarrera: number;
    creditosAprobados: number;
    cursosTotales: number;
    cursosAprobados: number;
  };
  semestres: SemestreProgreso[];
}

// Errores de dominio propios del servicio; el controller los traduce a HTTP.
export class EstudianteNoEncontradoError extends Error {}
export class PeriodoActivoInvalidoError extends Error {}
export class CursoNoEncontradoError extends Error {}
export class CursoFueraDeCarreraError extends Error {}
export class CursoNoMarcableError extends Error {}

/**
 * Formatea un valor Time de Prisma (llega como Date con fecha epoch
 * arbitraria, ej. 1970-01-01T13:00:00.000Z) a "HH:MM" en 24 horas.
 * Ver nota de arquitectura: "Prisma mapea Postgres TIME columns como
 * DateTime objects (not strings) -- conversion layer needed".
 */
function formatHora(fecha: Date): string {
  const horas = fecha.getUTCHours().toString().padStart(2, "0");
  const minutos = fecha.getUTCMinutes().toString().padStart(2, "0");
  return `${horas}:${minutos}`;
}

/**
 * Calcula la malla completa de un estudiante con el estado resuelto de
 * cada curso (aprobado / cursando / sin_seccion / pendiente).
 *
 * Regla de "sin_seccion" (confirmada en V4__agregar_estudiante_e_historial_curso.sql):
 * un curso queda en sin_seccion cuando, simultáneamente:
 *   1. Pertenece al ciclo_actual_id del estudiante (según su avance real).
 *   2. No tiene fila en historial_curso (no aprobado, no cursando).
 *   3. No existe ninguna `seccion` ofertada para ese curso en el periodo activo.
 * Si existe oferta pero el estudiante no se matriculó, es "pendiente" normal,
 * no "sin_seccion" -- ese caso no es un problema de oferta, es simplemente
 * un curso futuro/no tomado.
 *
 * Sección real por curso: cuando historial_curso.id_seccion no es null
 * (el caso típico es "cursando", donde el estudiante quedó matriculado
 * en una sección concreta), se incluye NRC, número de sección, profesor
 * y bloques horarios, para que el frontend pueda mostrar esta información
 * sin una llamada aparte a /api/horarios/secciones/:codigo.
 */
export async function getMallaProgreso(
  carnet: string
): Promise<MallaProgresoResponse> {
  const estudiante = await prisma.estudiante.findUnique({
    where: { carnet },
    include: { carrera: true },
  });

  if (!estudiante) {
    throw new EstudianteNoEncontradoError(
      `No existe un estudiante con carnet ${carnet}`
    );
  }

  const periodosActivos = await prisma.periodo.findMany({
    where: { activo: true },
  });

  if (periodosActivos.length !== 1) {
    // Fallo explícito en vez de adivinar cuál periodo usar.
    throw new PeriodoActivoInvalidoError(
      `Se esperaba exactamente 1 periodo activo, se encontraron ${periodosActivos.length}`
    );
  }
  const periodoActivo = periodosActivos[0];

  // Todos los cursos de la malla de la carrera del estudiante. Se resuelve
  // vía curso_carrera, no curso.id_carrera -- un mismo curso (ej. LIX410
  // "Inglés Integrado I") puede requerirse en varias carreras, cada una
  // en un ciclo distinto (ver V8__agregar_curso_carrera.sql). ciclo_id/
  // ciclo_nombre vienen de la fila curso_carrera (específicos de esta
  // carrera), el resto de curso.
  const cursosCarrera = await prisma.curso_carrera.findMany({
    where: { id_carrera: estudiante.id_carrera },
    include: { curso: true },
    orderBy: [{ ciclo_id: "asc" }, { curso: { codigo: "asc" } }],
  });
  const cursos = cursosCarrera.map((cc) => ({
    ...cc.curso,
    ciclo_id: cc.ciclo_id,
    ciclo_nombre: cc.ciclo_nombre,
  }));

  // Historial del estudiante, con la sección real (si existe) incluyendo
  // profesor y bloques horarios. Indexado por id_curso para lookup O(1).
  const historial = await prisma.historial_curso.findMany({
    where: { id_estudiante: estudiante.id_estudiante },
    include: {
      seccion: {
        include: {
          profesor: true,
          horario_bloque: true,
        },
      },
    },
  });
  const historialPorCurso = new Map(historial.map((h) => [h.id_curso, h]));

  // Cursos del ciclo actual que sí tienen alguna sección ofertada en el
  // periodo activo -- se resuelve en una sola consulta para no hacer N+1.
  const codigosCicloActual = cursos
    .filter((c) => c.ciclo_id === estudiante.ciclo_actual_id)
    .map((c) => c.codigo);

  const seccionesOfertadas = await prisma.seccion.findMany({
    where: {
      id_periodo: periodoActivo.id_periodo,
      codigo_curso_banner: { in: codigosCicloActual },
    },
    select: { codigo_curso_banner: true },
  });
  const codigosConOferta = new Set(
    seccionesOfertadas.map((s) => s.codigo_curso_banner)
  );

  // Construcción del estado resuelto por curso.
  const cursosConProgreso: CursoConProgreso[] = cursos.map((curso) => {
    const filaHistorial = historialPorCurso.get(curso.id_curso);

    let estado: EstadoCursoProgreso;
    if (filaHistorial) {
      // aprobado o cursando vienen directo del historial real.
      estado = filaHistorial.estado as EstadoCursoProgreso;
    } else if (
      curso.ciclo_id === estudiante.ciclo_actual_id &&
      !codigosConOferta.has(curso.codigo)
    ) {
      estado = "sin_seccion";
    } else {
      estado = "pendiente";
    }

    // Sección real solo si el historial la trae resuelta (típicamente
    // en "cursando"; un curso "aprobado" antiguo puede o no tenerla
    // según qué tan atrás llegue el historial real, y "pendiente"/
    // "sin_seccion" nunca la tienen por definición).
    const seccionInfo: SeccionInfo | null = filaHistorial?.seccion
      ? {
          nrc: filaHistorial.seccion.nrc,
          numeroSeccion: filaHistorial.seccion.numero_seccion,
          profesor: filaHistorial.seccion.profesor?.nombre ?? null,
          horarios: filaHistorial.seccion.horario_bloque.map((bloque) => ({
            dia: bloque.dia,
            horaInicio: formatHora(bloque.hora_inicio),
            horaFin: formatHora(bloque.hora_fin),
            aula: bloque.aula,
          })),
        }
      : null;

    return {
      idCurso: curso.id_curso,
      codigo: curso.codigo,
      nombre: curso.nombre,
      creditos: curso.creditos.toString(),
      cicloId: curso.ciclo_id,
      cicloNombre: curso.ciclo_nombre,
      esOptativo: curso.es_optativo,
      estado,
      nota: filaHistorial?.nota?.toString() ?? null,
      seccion: seccionInfo,
    };
  });

  // Agrupación por ciclo, preservando el orden ya resuelto por la query
  // (ciclo_id asc). No se reordena aquí con compareCycleIds porque el
  // orden lexicográfico de "ciclo_id" en la BD ya coincide con el orden
  // cronológico real para los datos existentes; si esto deja de cumplirse,
  // reemplazar por la misma lógica de malla.service.ts.
  const semestresMap = new Map<string, SemestreProgreso>();
  for (const curso of cursosConProgreso) {
    if (!semestresMap.has(curso.cicloId)) {
      semestresMap.set(curso.cicloId, {
        cicloId: curso.cicloId,
        cicloNombre: curso.cicloNombre,
        cursos: [],
      });
    }
    semestresMap.get(curso.cicloId)!.cursos.push(curso);
  }

  // Resumen global. El catálogo de electivas concretas ("Optativos",
  // ciclo_id="Opt") no es un requisito aparte -- son las opciones para
  // llenar los slots genéricos OPT{n}_{sigla} (es_optativo=true), que ya
  // viven dentro de su ciclo real (ej. "Cuarto Año - I Ciclo") y ya suman
  // su crédito una vez cada uno. Se excluye del total para no contar ~13
  // electivas como si cada una fuera un curso requerido independiente.
  const cursosRequeridos = cursos.filter((c) => c.ciclo_id !== "Opt");
  const creditosTotalesCarrera = cursosRequeridos.reduce(
    (sum, c) => sum + Number(c.creditos),
    0
  );

  const cursosAprobadosRequeridos = cursosConProgreso.filter(
    (c) => c.estado === "aprobado" && c.cicloId !== "Opt"
  );

  // Créditos aprobados: se excluye el crédito del slot genérico OPT{n}
  // (es_optativo=true, fuera del ciclo "Opt") aunque esté marcado como
  // aprobado -- no se sabe qué electiva concreta cubre. Ese crédito se
  // atribuye únicamente cuando el estudiante marca la electiva específica
  // en el catálogo "Optativos" (ciclo_id="Opt"), que sí participa aquí.
  const creditosAprobados = cursosConProgreso
    .filter((c) => c.estado === "aprobado")
    .filter((c) => c.cicloId === "Opt" || !c.esOptativo)
    .reduce((sum, c) => sum + Number(c.creditos), 0);

  return {
    estudiante: {
      carnet: estudiante.carnet,
      nombre: estudiante.nombre,
      cicloActualId: estudiante.ciclo_actual_id,
    },
    carrera: {
      idCarrera: estudiante.carrera.id_carrera,
      sigla: estudiante.carrera.sigla,
      nombre: estudiante.carrera.nombre,
    },
    resumen: {
      creditosTotalesCarrera,
      creditosAprobados,
      cursosTotales: cursosRequeridos.length,
      cursosAprobados: cursosAprobadosRequeridos.length,
    },
    semestres: Array.from(semestresMap.values()),
  };
}

/**
 * Marca un curso como aprobado en el historial del estudiante --
 * ingresado por el propio estudiante, no sincronizado con el registro
 * oficial (ver disclaimer de "dato auto-reportado" en la UI). No hay
 * columna de origen del dato: es la única fuente posible hoy.
 *
 * INSERT/UPDATE sobre el UNIQUE (id_estudiante, id_curso) -- si el curso
 * ya tenía una fila de historial (ej. "cursando" de un ciclo anterior),
 * la sobrescribe a "aprobado". No se permite marcar cursos fuera de la
 * carrera del estudiante, salvo los generales (es_general=true), que son
 * compartidos entre carreras por diseño (ver populate_db.py).
 */
export async function marcarCursoAprobado(
  carnet: string,
  codigoCurso: string
): Promise<void> {
  const estudiante = await prisma.estudiante.findUnique({ where: { carnet } });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }

  const curso = await prisma.curso.findUnique({ where: { codigo: codigoCurso } });
  if (!curso) {
    throw new CursoNoEncontradoError(`No existe un curso con código ${codigoCurso}`);
  }
  if (!curso.es_general) {
    // Pertenencia vía curso_carrera, no curso.id_carrera -- un curso
    // puede estar en la malla de varias carreras (ver getMallaProgreso).
    const pertenece = await prisma.curso_carrera.findUnique({
      where: {
        id_curso_id_carrera: {
          id_curso: curso.id_curso,
          id_carrera: estudiante.id_carrera,
        },
      },
    });
    if (!pertenece) {
      throw new CursoFueraDeCarreraError(
        `El curso ${codigoCurso} no pertenece a la carrera del estudiante`
      );
    }
  }

  await prisma.historial_curso.upsert({
    where: {
      id_estudiante_id_curso: {
        id_estudiante: estudiante.id_estudiante,
        id_curso: curso.id_curso,
      },
    },
    create: {
      id_estudiante: estudiante.id_estudiante,
      id_curso: curso.id_curso,
      estado: "aprobado",
    },
    update: {
      estado: "aprobado",
      actualizado_en: new Date(),
    },
  });
}

/**
 * Deshace un "marcar como aprobado" hecho por el propio estudiante,
 * borrando la fila de historial_curso. No se hardcodea el estado al que
 * vuelve el curso: al borrar la fila, getMallaProgreso recalcula si queda
 * "pendiente" o "sin_seccion" según la oferta vigente del periodo activo,
 * que es la misma regla que ya usa para cualquier curso sin historial.
 *
 * Solo deshace "aprobado" -- un curso "cursando" tiene una sección real
 * matriculada y su edición sigue fuera de alcance (mismo límite que
 * marcarCursoAprobado). Operación idempotente: si no hay fila de
 * historial, no hace nada en vez de fallar.
 */
export async function desmarcarCursoAprobado(
  carnet: string,
  codigoCurso: string
): Promise<void> {
  const estudiante = await prisma.estudiante.findUnique({ where: { carnet } });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }

  const curso = await prisma.curso.findUnique({ where: { codigo: codigoCurso } });
  if (!curso) {
    throw new CursoNoEncontradoError(`No existe un curso con código ${codigoCurso}`);
  }

  const filaHistorial = await prisma.historial_curso.findUnique({
    where: {
      id_estudiante_id_curso: {
        id_estudiante: estudiante.id_estudiante,
        id_curso: curso.id_curso,
      },
    },
  });

  if (!filaHistorial) return;

  if (filaHistorial.estado !== "aprobado") {
    throw new CursoNoMarcableError(
      `El curso ${codigoCurso} no está marcado como aprobado`
    );
  }

  await prisma.historial_curso.delete({
    where: {
      id_estudiante_id_curso: {
        id_estudiante: estudiante.id_estudiante,
        id_curso: curso.id_curso,
      },
    },
  });
}
import { PrismaClient } from "@prisma/client";
import { getDirectCorequisites, getDirectPrerequisites } from "./prerrequisito.service";

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

// -----------------------------------------------------------------------
// Tipos de salida del endpoint GET /api/estudiantes/:carnet/oferta
// -----------------------------------------------------------------------

export type EstadoOferta = "aprobado" | "cursando" | "elegible" | "bloqueado";

export interface SeccionOfertaInfo {
  nrc: string;
  numeroSeccion: string;
  profesor: string | null;
  capacidad: number;
  inscritos: number;
  disponibles: number;
  horarios: HorarioBloqueInfo[];
}

export interface CursoOferta {
  codigo: string;
  nombre: string;
  creditos: string;
  cicloId: string;
  cicloNombre: string;
  estado: EstadoOferta;
  // Solo no-vacío cuando estado === "bloqueado" -- los prerrequisitos
  // directos (tipo='prerequisito') que el estudiante todavía no tiene
  // en estado "aprobado" en su historial.
  prerrequisitosFaltantes: { code: string; name: string }[];
  // Informativo siempre que existan, sin importar el estado -- no
  // bloquea la elegibilidad (decisión: validar "ambos en el horario"
  // queda para Mi Horario, no para esta pantalla).
  corequisitos: { code: string; name: string; credits: number }[];
  // Solo presente cuando estado === "cursando": la sección real en la
  // que el estudiante ya quedó matriculado institucionalmente este
  // período (viene de historial_curso.id_seccion, no es una elección
  // del estudiante en esta pantalla).
  seccionActual: SeccionOfertaInfo | null;
  // Secciones ofertadas por Banner este período para este curso --
  // vacío jamás en la respuesta final, porque un curso sin ninguna
  // sección ofertada no aparece en el arreglo (ver getOfertaCiclo).
  secciones: SeccionOfertaInfo[];
}

/**
 * Oferta de cursos del período activo para la carrera del estudiante,
 * cruzando Banner (seccion) + su historial + el motor de prerrequisitos,
 * en una sola respuesta -- evita que el frontend arme esto con N
 * llamadas por curso.
 *
 * Alcance: TODOS los cursos de la carrera con al menos una sección
 * ofertada este período, sin filtrar por ciclo_actual_id -- un
 * estudiante puede necesitar adelantar una electiva o repetir un curso
 * de un ciclo anterior que Banner sí está ofertando (decisión
 * confirmada). Un curso sin ninguna sección ofertada no aparece en el
 * resultado: no hay nada que el estudiante pueda elegir para él.
 *
 * Estados:
 * - "aprobado"/"cursando": vienen directo de historial_curso.
 * - sin fila de historial: se corre el motor de prerrequisitos DIRECTOS
 *   (un solo nivel, no el árbol recursivo completo) contra el set de
 *   códigos que el estudiante tiene "aprobado" -- todos aprobados =
 *   "elegible", si falta alguno = "bloqueado" con el detalle de cuáles.
 */
export async function getOfertaCiclo(carnet: string): Promise<CursoOferta[]> {
  const estudiante = await prisma.estudiante.findUnique({
    where: { carnet },
    include: { carrera: true },
  });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }

  const periodosActivos = await prisma.periodo.findMany({ where: { activo: true } });
  if (periodosActivos.length !== 1) {
    throw new PeriodoActivoInvalidoError(
      `Se esperaba exactamente 1 periodo activo, se encontraron ${periodosActivos.length}`
    );
  }
  const periodoActivo = periodosActivos[0];

  const cursosCarrera = await prisma.curso_carrera.findMany({
    where: { id_carrera: estudiante.id_carrera },
    include: { curso: true },
  });

  // Estudios Generales (EGF/EGC/EGS/EGA): NUNCA viven en curso_carrera --
  // se insertan directo en `curso` desde Banner (es_general=true,
  // id_carrera NULL a propósito, ver _insert_general_courses_from_banner
  // en populate_db.py) porque no pertenecen a ninguna malla específica.
  // Sin agregarlos aparte, la oferta nunca los mostraba -- confirmado
  // contra la BD real (7 cursos es_general=true, 0 filas en
  // curso_carrera para todos). Sus SECCIONES sí siguen scoped por
  // carrera como cualquier otra (ver filtro de banner_program más abajo)
  // -- "sin malla propia" no es lo mismo que "sin restricción de oferta".
  const generales = await prisma.curso.findMany({ where: { es_general: true } });

  type CandidatoOferta = { curso: (typeof cursosCarrera)[number]["curso"]; cicloId: string; cicloNombre: string };
  const cursosCandidatos: CandidatoOferta[] = [
    ...cursosCarrera.map((cc) => ({ curso: cc.curso, cicloId: cc.ciclo_id, cicloNombre: cc.ciclo_nombre })),
    ...generales.map((g) => ({ curso: g, cicloId: g.ciclo_id, cicloNombre: g.ciclo_nombre })),
  ];
  const codigos = cursosCandidatos.map((c) => c.curso.codigo);

  const todasLasSecciones = await prisma.seccion.findMany({
    where: { id_periodo: periodoActivo.id_periodo, codigo_curso_banner: { in: codigos } },
    include: { profesor: true, horario_bloque: true },
    orderBy: { numero_seccion: "asc" },
  });

  // Filtrado por carrera: codigo_curso_banner por sí solo no basta -- un
  // curso compartido (ej. LIX410 "Inglés Integrado I", o un general como
  // EGA121) puede tener secciones distintas por carrera en Banner
  // (banner_program en metadata, poblado por populate_db.py desde el
  // archivo banner_*.json de origen -- cada búsqueda de Banner solo trae
  // las secciones que esa carrera puede tomar realmente, no es una
  // etiqueta arbitraria). Sin este filtro, un estudiante de ISI veía
  // TAMBIÉN secciones publicadas para otras carreras aunque su propio
  // banner_isi_*.json no las ofertara -- confirmado dos veces: con
  // LIX410 (2 secciones reales vs 4 en la UI) y con los generales (2
  // secciones reales en banner_isi vs 6 cursos generales en la UI, antes
  // de quitar la excepción que los dejaba sin filtrar). banner_program
  // ausente/null = sección sin scope conocido, se muestra a cualquier
  // carrera (mismo criterio que usa el MERGE en populate_db.py para no
  // perder secciones huérfanas de metadata).
  const secciones = todasLasSecciones.filter((s) => {
    const metadata = s.metadata as Record<string, unknown> | null;
    const bannerProgram = metadata?.banner_program;
    return !bannerProgram || bannerProgram === estudiante.carrera.sigla;
  });

  const seccionesPorCurso = new Map<string, typeof secciones>();
  for (const s of secciones) {
    const lista = seccionesPorCurso.get(s.codigo_curso_banner) ?? [];
    lista.push(s);
    seccionesPorCurso.set(s.codigo_curso_banner, lista);
  }

  const mapSeccion = (s: (typeof secciones)[number]): SeccionOfertaInfo => ({
    nrc: s.nrc,
    numeroSeccion: s.numero_seccion,
    profesor: s.profesor?.nombre ?? null,
    capacidad: s.capacidad,
    inscritos: s.inscritos,
    disponibles: s.disponibles,
    horarios: s.horario_bloque.map((b) => ({
      dia: b.dia,
      horaInicio: formatHora(b.hora_inicio),
      horaFin: formatHora(b.hora_fin),
      aula: b.aula,
    })),
  });

  // curso: true (no solo id_curso) porque un curso aprobado puede no
  // pertenecer a curso_carrera de ESTA carrera (ej. un general) y aun
  // así debe contar para desbloquear prerrequisitos de otros cursos.
  const historial = await prisma.historial_curso.findMany({
    where: { id_estudiante: estudiante.id_estudiante },
    include: {
      curso: true,
      seccion: { include: { profesor: true, horario_bloque: true } },
    },
  });
  const historialPorCurso = new Map(historial.map((h) => [h.id_curso, h]));
  const codigosAprobados = new Set(
    historial.filter((h) => h.estado === "aprobado").map((h) => h.curso.codigo)
  );

  const cursosConOferta = cursosCandidatos.filter((c) =>
    seccionesPorCurso.has(c.curso.codigo)
  );

  const resultado: CursoOferta[] = [];
  for (const candidato of cursosConOferta) {
    const curso = candidato.curso;
    const filaHistorial = historialPorCurso.get(curso.id_curso);
    const seccionesOfertadas = seccionesPorCurso.get(curso.codigo) ?? [];
    const corequisitos = await getDirectCorequisites(curso.id_curso, estudiante.id_carrera);

    let estado: EstadoOferta;
    let prerrequisitosFaltantes: { code: string; name: string }[] = [];
    let seccionActual: SeccionOfertaInfo | null = null;

    if (filaHistorial?.estado === "aprobado") {
      estado = "aprobado";
    } else if (filaHistorial?.estado === "cursando") {
      estado = "cursando";
      seccionActual = filaHistorial.seccion ? mapSeccion(filaHistorial.seccion) : null;
    } else {
      const prerequisitosDirectos = await getDirectPrerequisites(curso.id_curso, estudiante.id_carrera);
      prerrequisitosFaltantes = prerequisitosDirectos.filter(
        (p) => !codigosAprobados.has(p.code)
      );
      estado = prerrequisitosFaltantes.length > 0 ? "bloqueado" : "elegible";
    }

    resultado.push({
      codigo: curso.codigo,
      nombre: curso.nombre,
      creditos: curso.creditos.toString(),
      cicloId: candidato.cicloId,
      cicloNombre: candidato.cicloNombre,
      estado,
      prerrequisitosFaltantes,
      corequisitos,
      seccionActual,
      secciones: seccionesOfertadas.map(mapSeccion),
    });
  }

  resultado.sort((a, b) => a.codigo.localeCompare(b.codigo));
  return resultado;
}

export class SeccionNoEncontradaError extends Error {}

/**
 * Confirma la matrícula del borrador armado en Mis Cursos: por cada NRC,
 * sube historial_curso a estado='cursando' con la sección real elegida.
 * Mismo patrón de upsert y de validación de pertenencia a la carrera que
 * marcarCursoAprobado -- sin validación extra contra un 'aprobado'
 * existente, porque el frontend ya solo deja seleccionar cursos
 * "elegibles" (sin fila de historial todavía), así que ese NRC nunca
 * debería llegar acá para un curso ya aprobado.
 *
 * Corre en una transacción: si un NRC falla (no existe en el periodo
 * activo, o el curso no pertenece a la carrera), NINGÚN curso del lote
 * se confirma -- evita una matrícula parcial silenciosa.
 */
export async function confirmarMatricula(carnet: string, nrcs: string[]): Promise<void> {
  const estudiante = await prisma.estudiante.findUnique({ where: { carnet } });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }

  const periodosActivos = await prisma.periodo.findMany({ where: { activo: true } });
  if (periodosActivos.length !== 1) {
    throw new PeriodoActivoInvalidoError(
      `Se esperaba exactamente 1 periodo activo, se encontraron ${periodosActivos.length}`
    );
  }
  const periodoActivo = periodosActivos[0];

  await prisma.$transaction(async (tx) => {
    for (const nrc of nrcs) {
      // findFirst, no findUnique: la constraint real es (nrc, id_periodo),
      // no nrc solo (ver horario.routes.ts).
      const seccion = await tx.seccion.findFirst({
        where: { nrc, id_periodo: periodoActivo.id_periodo },
        include: { curso: true },
      });
      if (!seccion || !seccion.curso) {
        throw new SeccionNoEncontradaError(
          `No se encontró la sección con NRC ${nrc} en el período activo`
        );
      }
      const curso = seccion.curso;

      if (!curso.es_general) {
        const pertenece = await tx.curso_carrera.findUnique({
          where: {
            id_curso_id_carrera: {
              id_curso: curso.id_curso,
              id_carrera: estudiante.id_carrera,
            },
          },
        });
        if (!pertenece) {
          throw new CursoFueraDeCarreraError(
            `El curso ${curso.codigo} no pertenece a la carrera del estudiante`
          );
        }
      }

      await tx.historial_curso.upsert({
        where: {
          id_estudiante_id_curso: {
            id_estudiante: estudiante.id_estudiante,
            id_curso: curso.id_curso,
          },
        },
        create: {
          id_estudiante: estudiante.id_estudiante,
          id_curso: curso.id_curso,
          estado: "cursando",
          id_seccion: seccion.id_seccion,
          id_periodo: periodoActivo.id_periodo,
        },
        update: {
          estado: "cursando",
          id_seccion: seccion.id_seccion,
          id_periodo: periodoActivo.id_periodo,
          actualizado_en: new Date(),
        },
      });
    }
  });
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
 * Deshace un "marcar como aprobado" O una matrícula confirmada
 * ("cursando"), borrando la fila de historial_curso. No se hardcodea el
 * estado al que vuelve el curso: al borrar la fila, getMallaProgreso /
 * getOfertaCiclo recalculan el estado que corresponda (pendiente,
 * sin_seccion, elegible o bloqueado) según la oferta y prerrequisitos
 * vigentes -- misma regla que ya usa cualquier curso sin historial.
 *
 * Generalizado a partir de la versión que solo aceptaba "aprobado":
 * desde el punto de vista del estudiante, "quitar un curso del
 * borrador" y "dar de baja un curso ya confirmado" son la misma acción
 * (un solo click, sin distinción de comportamiento) -- ver Mis Cursos.
 * "cursando" tenía una sección real matriculada; borrar la fila no
 * borra la sección de Banner, solo el vínculo del estudiante con ella.
 * Operación idempotente: si no hay fila de historial, no hace nada en
 * vez de fallar.
 */
export async function desmarcarCurso(
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

  if (filaHistorial.estado !== "aprobado" && filaHistorial.estado !== "cursando") {
    throw new CursoNoMarcableError(
      `El curso ${codigoCurso} no está marcado como aprobado ni cursando`
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
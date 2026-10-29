import { PrismaClient } from "@prisma/client";
import { getDirectCorequisites } from "./prerrequisito.service";
import {
  buildEligibilityContext,
  evaluateCourse,
  loadEligibilityContext,
  type MissingPrerequisite,
  type PeriodRef,
} from "./elegibilidad.service";
import {
  listSchedulePeriods,
  resolvePeriod,
  resolveSchedulePeriod,
  toPeriodRef,
  type PeriodoHorario,
} from "./periodo.service";

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
  // Solo presente en slots GEN{n}/OPT{n} con una asignación explícita
  // (historial_curso.id_slot_malla, ver V9) -- el código/nombre del curso
  // real que el estudiante eligió para llenar este slot vía el Sheet de
  // "marcar aprobado con selector". null en cualquier otro caso, incluido
  // un slot GEN{n} legacy sin backfillear (ver diagnostico_backfill).
  cursoRealCodigo: string | null;
  cursoRealNombre: string | null;
  // Solo presente cuando historial_curso.id_seccion no es null (típicamente
  // en estado "cursando"). null en cualquier otro caso -- no se inventa
  // una sección para cursos aprobados históricos sin ese dato, ni para
  // pendiente/sin_seccion, que por definición no tienen sección propia.
  seccion: SeccionInfo | null;
  // Solo presente en estado "cursando": el período en que el estudiante
  // está matriculado (historial_curso.id_periodo). El frontend muestra su
  // nombre cuando difiere de periodoPredeterminado.
  periodoCursando: PeriodRef | null;
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
  // Período predeterminado (el que está en curso), contra el que se
  // calcula "sin_seccion" y contra el que se compara periodoCursando.
  periodoPredeterminado: PeriodRef;
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
export class CursoNoEncontradoError extends Error {}
export class CursoFueraDeCarreraError extends Error {}
export class CursoNoMarcableError extends Error {}
export class SlotInvalidoError extends Error {}
export class TopeSlotsAlcanzadoError extends Error {}
export class CursoYaAsignadoAOtroSlotError extends Error {}
export class TopeGeneralesMatriculaError extends Error {}
export class TopeOptativasMatriculaError extends Error {}

// Mismo tope que contarSlotsUsados (GEN siempre 4, confirmado en las 5
// carreras vía PLANES_DE_ESTUDIO.xlsx) -- se usa tanto en getOfertaCiclo
// (para marcar "bloqueado" un general nuevo cuando ya se llegó al tope)
// como en confirmarMatricula (para rechazar la matrícula si se intenta
// igual, ej. request directo sin pasar por la UI).
const MAXIMO_GENERALES_MATRICULA = 4;

/**
 * Identifica una electiva REAL del catálogo "Optativos" (ciclo_id="Opt",
 * es_optativo=false, es_general=false, ver excel_loader.py) -- distinta
 * del slot genérico OPT{n}_{sigla} de la malla (es_optativo=true, fuera
 * del ciclo "Opt", ver contarSlotsUsados). Solo las electivas reales
 * cuentan contra el tope de optativas de Mis Cursos/confirmarMatricula.
 */
function esOptativaCatalogo(curso: {
  ciclo_id: string;
  es_optativo: boolean;
  es_general: boolean;
}): boolean {
  return curso.ciclo_id === "Opt" && !curso.es_optativo && !curso.es_general;
}

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

/** Período de una fila 'cursando' (null en cualquier otro estado). */
function periodoDeCursando(
  fila: { estado: string; periodo: { codigo: string; nombre: string } | null } | undefined
): PeriodRef | null {
  if (fila?.estado !== "cursando" || !fila.periodo) return null;
  return toPeriodRef(fila.periodo);
}

/**
 * Calcula la malla completa de un estudiante con el estado resuelto de
 * cada curso (aprobado / cursando / sin_seccion / pendiente).
 *
 * Regla de "sin_seccion" (confirmada en V4__agregar_estudiante_e_historial_curso.sql):
 * un curso queda en sin_seccion cuando, simultáneamente:
 *   1. Pertenece al ciclo_actual_id del estudiante (según su avance real).
 *   2. No tiene fila en historial_curso (no aprobado, no cursando).
 *   3. No existe ninguna `seccion` ofertada para ese curso en el período
 *      predeterminado (el que está en curso, ver resolvePeriod).
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

  const periodoPredeterminado = await resolvePeriod();

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
  const cursosDeCarrera = cursosCarrera.map((cc) => ({
    ...cc.curso,
    ciclo_id: cc.ciclo_id,
    ciclo_nombre: cc.ciclo_nombre,
  }));

  // Estudios Generales (EGF/EGC/EGS/EGA): igual que en getOfertaCiclo,
  // NUNCA viven en curso_carrera -- se agregan aparte, agrupadas bajo un
  // ciclo sintético "Estudios Generales" (no el ciclo_id="Opt" que traen
  // en `curso` desde populate_db.py, reservado para el catálogo real de
  // electivas). Sin esto, un curso general que el estudiante ya está
  // cursando o aprobó no aparecía en la malla ni en el dashboard --
  // getMallaProgreso solo consultaba curso_carrera. No cuentan para el
  // avance de carrera (creditosTotalesCarrera/creditosAprobados): son
  // compartidos entre carreras, no parte de esta malla específica (ver
  // exclusión más abajo, misma que ya existe para "Opt").
  const generales = await prisma.curso.findMany({ where: { es_general: true } });
  const cursosGenerales = generales.map((g) => ({
    ...g,
    ciclo_id: "General",
    ciclo_nombre: "Estudios Generales",
  }));

  const cursos = [...cursosDeCarrera, ...cursosGenerales];

  // Historial del estudiante, con la sección real (si existe) incluyendo
  // profesor y bloques horarios. Indexado por id_curso para lookup O(1).
  const historial = await prisma.historial_curso.findMany({
    where: { id_estudiante: estudiante.id_estudiante },
    include: {
      curso: true,
      periodo: true,
      seccion: {
        include: {
          profesor: true,
          horario_bloque: true,
        },
      },
    },
  });
  const historialPorCurso = new Map(historial.map((h) => [h.id_curso, h]));
  // Asignación explícita slot -> curso real (ver V9). Reemplaza el
  // emparejamiento heurístico por orden para cualquier fila ya migrada
  // por el backfill o creada por el nuevo flujo de asignarCursoRealASlot.
  const historialPorSlot = new Map(
    historial.filter((h) => h.id_slot_malla !== null).map((h) => [h.id_slot_malla as number, h])
  );

  // Cursos del ciclo actual que sí tienen alguna sección ofertada en el
  // periodo activo -- se resuelve en una sola consulta para no hacer N+1.
  const codigosCicloActual = cursos
    .filter((c) => c.ciclo_id === estudiante.ciclo_actual_id)
    .map((c) => c.codigo);

  const seccionesOfertadas = await prisma.seccion.findMany({
    where: {
      id_periodo: periodoPredeterminado.id_periodo,
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
      cursoRealCodigo: null,
      cursoRealNombre: null,
      seccion: seccionInfo,
      periodoCursando: periodoDeCursando(filaHistorial),
    };
  });

  // Completar los slots genéricos GEN{n}_{sigla}/OPT{n}_{sigla} (creados
  // por excel_loader.py) con el curso real que el estudiante asignó vía
  // el Sheet de "marcar aprobado con selector" (ver asignarCursoRealASlot,
  // V9) -- historial_curso.id_slot_malla es ahora la fuente de verdad,
  // explícita y persistida, de qué curso real llena cada slot. Solo se
  // completan los slots SIN historial propio -- si el estudiante ya marcó
  // el slot mismo como aprobado a mano (fila real para ese id_curso
  // puntual, caso legacy), esa decisión no se pisa.
  const slotsGenerales = cursosConProgreso.filter(
    (c) => /^GEN\d+_/.test(c.codigo) && !historialPorCurso.has(c.idCurso)
  );
  const slotsOptativas = cursosConProgreso.filter(
    (c) => /^OPT\d+_/.test(c.codigo) && !historialPorCurso.has(c.idCurso)
  );

  for (const slot of [...slotsGenerales, ...slotsOptativas]) {
    const asignacion = historialPorSlot.get(slot.idCurso);
    if (!asignacion) continue;
    slot.estado = asignacion.estado as EstadoCursoProgreso;
    slot.nota = asignacion.nota?.toString() ?? null;
    slot.cursoRealCodigo = asignacion.curso.codigo;
    slot.cursoRealNombre = asignacion.curso.nombre;
    slot.periodoCursando = periodoDeCursando(asignacion);
    slot.seccion = asignacion.seccion
      ? {
          nrc: asignacion.seccion.nrc,
          numeroSeccion: asignacion.seccion.numero_seccion,
          profesor: asignacion.seccion.profesor?.nombre ?? null,
          horarios: asignacion.seccion.horario_bloque.map((bloque) => ({
            dia: bloque.dia,
            horaInicio: formatHora(bloque.hora_inicio),
            horaFin: formatHora(bloque.hora_fin),
            aula: bloque.aula,
          })),
        }
      : null;
  }

  // Red de seguridad: slots GEN de datos aún no backfillados (ver V9,
  // script backfill-slot-malla.ts) -- se resuelven con la misma
  // heurística por orden que existía antes de id_slot_malla, para no
  // regresar a "Pendiente" mientras el backfill de ese entorno no haya
  // corrido todavía (ej. producción, antes de aplicar este cambio ahí).
  const slotsGeneralesSinAsignar = slotsGenerales
    .filter((s) => !historialPorSlot.has(s.idCurso))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));

  const codigosGeneralesReales = new Set(cursosGenerales.map((g) => g.codigo));
  const generalesCursadosSinSlot = cursosConProgreso
    .filter((c) => codigosGeneralesReales.has(c.codigo))
    .filter((c) => c.estado === "aprobado" || c.estado === "cursando")
    .filter((c) => !Array.from(historialPorSlot.values()).some((h) => h.id_curso === c.idCurso))
    .sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === "aprobado" ? -1 : 1;
      return a.codigo.localeCompare(b.codigo);
    });

  for (
    let i = 0;
    i < Math.min(slotsGeneralesSinAsignar.length, generalesCursadosSinSlot.length);
    i++
  ) {
    const slot = slotsGeneralesSinAsignar[i];
    const fuente = generalesCursadosSinSlot[i];
    slot.estado = fuente.estado;
    slot.nota = fuente.nota;
    slot.cursoRealCodigo = fuente.codigo;
    slot.cursoRealNombre = fuente.nombre;
    slot.seccion = fuente.seccion;
    slot.periodoCursando = fuente.periodoCursando;
  }

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
  const cursosRequeridos = cursos.filter(
    (c) => c.ciclo_id !== "Opt" && c.ciclo_id !== "General"
  );
  const creditosTotalesCarrera = cursosRequeridos.reduce(
    (sum, c) => sum + Number(c.creditos),
    0
  );

  const cursosAprobadosRequeridos = cursosConProgreso.filter(
    (c) => c.estado === "aprobado" && c.cicloId !== "Opt" && c.cicloId !== "General"
  );

  // Créditos aprobados: se excluye el crédito del slot genérico OPT{n}
  // (es_optativo=true, fuera del ciclo "Opt") aunque esté marcado como
  // aprobado -- no se sabe qué electiva concreta cubre. Ese crédito se
  // atribuye únicamente cuando el estudiante marca la electiva específica
  // en el catálogo "Optativos" (ciclo_id="Opt"), que sí participa aquí.
  const creditosAprobados = cursosConProgreso
    .filter((c) => c.estado === "aprobado")
    .filter((c) => c.cicloId === "Opt" || !c.esOptativo)
    .filter((c) => c.cicloId !== "General")
    .reduce((sum, c) => sum + Number(c.creditos), 0);

  return {
    estudiante: {
      carnet: estudiante.carnet,
      nombre: estudiante.nombre,
      cicloActualId: estudiante.ciclo_actual_id,
    },
    periodoPredeterminado: toPeriodRef(periodoPredeterminado),
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
  estadoOferta: string;
  horarios: HorarioBloqueInfo[];
}

export interface CursoOferta {
  codigo: string;
  nombre: string;
  creditos: string;
  cicloId: string;
  cicloNombre: string;
  estado: EstadoOferta;
  // Curso de Estudios Generales (EGF/EGC/EGS/EGA, es_general=true en el
  // modelo) -- el frontend lo usa para bloquear la matrícula de un 5to
  // general una vez el estudiante ya tiene 4 aprobados/cursando (ver
  // MAXIMO_GENERALES_MATRICULA en confirmarMatricula).
  esGeneral: boolean;
  // Electiva real del catálogo "Optativos" (esOptativaCatalogo) -- el
  // frontend lo usa igual que esGeneral, contra maximoOptativas (tope
  // dinámico por carrera, no un número fijo).
  esOptativa: boolean;
  // Tope de optativas de la carrera del estudiante (dinámico, ver
  // contarSlotsUsados) -- mismo valor en todas las filas, se repite por
  // fila para que el frontend no necesite un segundo endpoint.
  maximoOptativas: number;
  // Solo no-vacío cuando estado === "bloqueado" -- los prerrequisitos
  // directos (tipo='prerequisito') que el estudiante todavía no tiene
  // en estado "aprobado" en su historial. enCurso=true si ese faltante
  // está 'cursando' (no cuenta como cumplido, ver elegibilidad.service.ts).
  prerrequisitosFaltantes: MissingPrerequisite[];
  // Razón textual de bloqueo cuando NO es por prerrequisitos (ej. tope de
  // 4 Estudios Generales ya alcanzado) -- prerrequisitosFaltantes queda
  // vacío en ese caso porque no es ese tipo de bloqueo.
  motivoBloqueo: string | null;
  // Informativo siempre que existan, sin importar el estado -- no
  // bloquea la elegibilidad (decisión: validar "ambos en el horario"
  // queda para Mi Horario, no para esta pantalla).
  corequisitos: { code: string; name: string; credits: number }[];
  // Solo presente cuando estado === "cursando": la sección real en la
  // que el estudiante ya quedó matriculado institucionalmente este
  // período (viene de historial_curso.id_seccion, no es una elección
  // del estudiante en esta pantalla).
  seccionActual: SeccionOfertaInfo | null;
  // Solo presente cuando estado === "cursando": el período en que el
  // estudiante está matriculado. Puede ser distinto del período pedido
  // (un curso 'cursando' se ve como Cursando en todos los períodos).
  periodoCursando: PeriodRef | null;
  // Secciones ofertadas por Banner este período para este curso --
  // vacío jamás en la respuesta final, porque un curso sin ninguna
  // sección ofertada no aparece en el arreglo (ver getOfertaCiclo).
  secciones: SeccionOfertaInfo[];
}

/**
 * Oferta de cursos de un período (el predeterminado si no se indica) para
 * la carrera del estudiante,
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
 * Estados: ver evaluateCourse en elegibilidad.service.ts (única fuente de
 * verdad, compartida con confirmarMatricula). Sobre "elegible" se aplican
 * además los topes de Generales/Optativas, que son del plan y no se
 * acotan por período.
 */
export async function getOfertaCiclo(
  carnet: string,
  codigoPeriodo?: string
): Promise<CursoOferta[]> {
  const estudiante = await prisma.estudiante.findUnique({
    where: { carnet },
    include: { carrera: true },
  });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }

  const periodo = await resolvePeriod(codigoPeriodo);

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
    where: { id_periodo: periodo.id_periodo, codigo_curso_banner: { in: codigos } },
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
    estadoOferta: s.estado_oferta,
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
      periodo: true,
      seccion: { include: { profesor: true, horario_bloque: true } },
    },
  });
  const historialPorCurso = new Map(historial.map((h) => [h.id_curso, h]));

  // Generales que ya cuentan contra el tope de 4 (aprobado/cursando) --
  // un general SIN fila de historial se marca "bloqueado" en vez de
  // "elegible" si ya se llegó al tope, para que el estudiante no lo vea
  // como una opción real en Mis Cursos (confirmarMatricula igual lo
  // rechaza si se intenta de todos modos, ver TopeGeneralesMatriculaError).
  const generalesActuales = historial.filter(
    (h) => h.curso.es_general && (h.estado === "aprobado" || h.estado === "cursando")
  ).length;
  const topeGeneralesAlcanzado = generalesActuales >= MAXIMO_GENERALES_MATRICULA;

  // Mismo criterio que generales, pero para optativas reales del
  // catálogo (esOptativaCatalogo) -- tope dinámico por carrera, igual
  // que contarSlotsUsados (ISI: 4, Ciencia de Datos: 3, etc.).
  const optativasActuales = historial.filter(
    (h) => esOptativaCatalogo(h.curso) && (h.estado === "aprobado" || h.estado === "cursando")
  ).length;
  const maximoOptativas = await prisma.curso_carrera.count({
    where: { id_carrera: estudiante.id_carrera, curso: { es_optativo: true } },
  });
  const topeOptativasAlcanzado = optativasActuales >= maximoOptativas;

  const cursosConOferta = cursosCandidatos.filter((c) =>
    seccionesPorCurso.has(c.curso.codigo)
  );

  const elegibilidad = await buildEligibilityContext(
    prisma,
    historial,
    cursosConOferta.map((c) => c.curso.id_curso),
    estudiante.id_carrera
  );

  const resultado: CursoOferta[] = [];
  for (const candidato of cursosConOferta) {
    const curso = candidato.curso;
    const filaHistorial = historialPorCurso.get(curso.id_curso);
    const seccionesOfertadas = seccionesPorCurso.get(curso.codigo) ?? [];
    const corequisitos = await getDirectCorequisites(curso.id_curso, estudiante.id_carrera);

    const evaluacion = evaluateCourse(elegibilidad, curso.id_curso);
    let estado: EstadoOferta = evaluacion.estado;
    let motivoBloqueo: string | null = null;
    const seccionActual: SeccionOfertaInfo | null =
      estado === "cursando" && filaHistorial?.seccion ? mapSeccion(filaHistorial.seccion) : null;

    if (estado === "elegible" && curso.es_general && topeGeneralesAlcanzado) {
      estado = "bloqueado";
      motivoBloqueo = `Ya completaste tus ${MAXIMO_GENERALES_MATRICULA} Estudios Generales`;
    } else if (estado === "elegible" && esOptativaCatalogo(curso) && topeOptativasAlcanzado) {
      estado = "bloqueado";
      motivoBloqueo = `Ya completaste tus ${maximoOptativas} optativas`;
    }

    resultado.push({
      codigo: curso.codigo,
      nombre: curso.nombre,
      creditos: curso.creditos.toString(),
      cicloId: candidato.cicloId,
      cicloNombre: candidato.cicloNombre,
      estado,
      esGeneral: curso.es_general,
      esOptativa: esOptativaCatalogo(curso),
      maximoOptativas,
      prerrequisitosFaltantes: evaluacion.prerrequisitosFaltantes,
      motivoBloqueo,
      corequisitos,
      seccionActual,
      periodoCursando: evaluacion.periodoCursando,
      secciones: seccionesOfertadas.map(mapSeccion),
    });
  }

  resultado.sort((a, b) => a.codigo.localeCompare(b.codigo));
  return resultado;
}

export class SeccionNoEncontradaError extends Error {}
export class CursoYaAprobadoError extends Error {}
export class CursoCursandoEnOtroPeriodoError extends Error {}
export class PrerrequisitosNoCumplidosError extends Error {}

/**
 * Confirma la matrícula del borrador armado en Mis Cursos: por cada NRC,
 * sube historial_curso a estado='cursando' con la sección real elegida.
 * Mismo patrón de upsert y de validación de pertenencia a la carrera que
 * marcarCursoAprobado.
 *
 * Elegibilidad: se valida en backend con la MISMA función que usa la
 * oferta (evaluateCourse), sin confiar en que el frontend solo deje
 * elegir cursos "elegibles". Se rechaza:
 * - un curso ya 'aprobado' (el upsert lo bajaría a 'cursando');
 * - un curso 'cursando' en OTRO período (cursando en este mismo período
 *   sí se permite: es un cambio de sección);
 * - un curso con prerrequisitos faltantes ('cursando' no los cumple).
 *
 * Además bloquea un NUEVO curso general (es_general=true, sin fila de
 * historial todavía) si el estudiante ya tiene MAXIMO_GENERALES_MATRICULA
 * generales en aprobado/cursando, y lo mismo para una NUEVA optativa real
 * (esOptativaCatalogo) contra el tope de optativas de su carrera (dinámico,
 * ver contarSlotsUsados) -- ambos conteos se llevan dentro del loop (no
 * solo antes) para que matricular 2+ nuevas del mismo tipo en el mismo
 * lote tampoco se salte el tope.
 *
 * Corre en una transacción: si un NRC falla (no existe en el período,
 * el curso no pertenece a la carrera, no es elegible, o se alcanza el
 * tope de generales/optativas), NINGÚN curso del lote se confirma --
 * evita una matrícula parcial silenciosa. Siempre guarda id_periodo.
 */
export async function confirmarMatricula(
  carnet: string,
  nrcs: string[],
  codigoPeriodo?: string
): Promise<void> {
  const estudiante = await prisma.estudiante.findUnique({ where: { carnet } });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }

  const periodo = await resolvePeriod(codigoPeriodo);

  await prisma.$transaction(async (tx) => {
    let generalesActuales = await tx.historial_curso.count({
      where: {
        id_estudiante: estudiante.id_estudiante,
        estado: { in: ["aprobado", "cursando"] },
        curso: { es_general: true },
      },
    });

    let optativasActuales = await tx.historial_curso.count({
      where: {
        id_estudiante: estudiante.id_estudiante,
        estado: { in: ["aprobado", "cursando"] },
        curso: { ciclo_id: "Opt", es_optativo: false, es_general: false },
      },
    });
    const maximoOptativas = await tx.curso_carrera.count({
      where: { id_carrera: estudiante.id_carrera, curso: { es_optativo: true } },
    });

    const seccionesDelLote = await tx.seccion.findMany({
      where: { nrc: { in: nrcs }, id_periodo: periodo.id_periodo },
      select: { id_curso: true },
    });
    const elegibilidad = await loadEligibilityContext(
      tx,
      estudiante.id_estudiante,
      estudiante.id_carrera,
      seccionesDelLote.flatMap((s) => (s.id_curso === null ? [] : [s.id_curso]))
    );

    for (const nrc of nrcs) {
      // findFirst, no findUnique: la constraint real es (nrc, id_periodo),
      // no nrc solo (ver horario.routes.ts).
      const seccion = await tx.seccion.findFirst({
        where: { nrc, id_periodo: periodo.id_periodo },
        include: { curso: true },
      });
      if (!seccion || !seccion.curso) {
        throw new SeccionNoEncontradaError(
          `No se encontró la sección con NRC ${nrc} en el período ${periodo.codigo}`
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

      const evaluacion = evaluateCourse(elegibilidad, curso.id_curso);
      if (evaluacion.estado === "aprobado") {
        throw new CursoYaAprobadoError(`El curso ${curso.codigo} ya está aprobado`);
      }
      if (
        evaluacion.estado === "cursando" &&
        evaluacion.periodoCursando?.codigo !== periodo.codigo
      ) {
        const enPeriodo = evaluacion.periodoCursando?.nombre ?? "otro período";
        throw new CursoCursandoEnOtroPeriodoError(
          `El curso ${curso.codigo} ya está matriculado en ${enPeriodo}`
        );
      }
      if (evaluacion.estado === "bloqueado") {
        const faltantes = evaluacion.prerrequisitosFaltantes.map((p) => p.code).join(", ");
        throw new PrerrequisitosNoCumplidosError(
          `El curso ${curso.codigo} requiere aprobar: ${faltantes}`
        );
      }

      if (curso.es_general) {
        const yaEnHistorial = await tx.historial_curso.findUnique({
          where: {
            id_estudiante_id_curso: {
              id_estudiante: estudiante.id_estudiante,
              id_curso: curso.id_curso,
            },
          },
        });
        // Solo cuenta contra el tope si es un general NUEVO -- re-elegir
        // otra sección de un general que ya está "cursando" no debe
        // bloquearse por el tope que él mismo ya ocupa.
        if (!yaEnHistorial) {
          if (generalesActuales >= MAXIMO_GENERALES_MATRICULA) {
            throw new TopeGeneralesMatriculaError(
              `Ya tienes ${MAXIMO_GENERALES_MATRICULA} Estudios Generales aprobados o cursando -- no puedes matricular otro`
            );
          }
          generalesActuales++;
        }
      }

      if (esOptativaCatalogo(curso)) {
        const yaEnHistorial = await tx.historial_curso.findUnique({
          where: {
            id_estudiante_id_curso: {
              id_estudiante: estudiante.id_estudiante,
              id_curso: curso.id_curso,
            },
          },
        });
        // Mismo criterio que generales: solo cuenta contra el tope si es
        // una optativa NUEVA, no un cambio de sección de una ya cursando.
        if (!yaEnHistorial) {
          if (optativasActuales >= maximoOptativas) {
            throw new TopeOptativasMatriculaError(
              `Ya tienes ${maximoOptativas} optativas aprobadas o cursando -- no puedes matricular otra`
            );
          }
          optativasActuales++;
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
          id_periodo: periodo.id_periodo,
        },
        update: {
          estado: "cursando",
          id_seccion: seccion.id_seccion,
          id_periodo: periodo.id_periodo,
          actualizado_en: new Date(),
        },
      });
    }
  });
}

/**
 * Resuelve a qué curso real de generales (es_general=true) corresponde
 * un slot GEN{n}_{sigla} sin historial propio, replicando el mismo
 * emparejamiento estable que el autocompletado de getMallaProgreso
 * (slot libre <- curso de generales cursado/aprobado, en orden). Se usa
 * desde marcarCursoAprobado para que togglear el switch de un slot
 * autocompletado actúe sobre el curso real (ej. EGA121), no sobre el
 * slot -- si no, se crea una fila de historial huérfana para el código
 * GEN* y el curso real (que sigue mostrándose aparte, ver bucket
 * "General" en getMallaProgreso) se queda sin actualizar.
 * Devuelve null si el slot no está cubierto por ningún curso real
 * (caso legítimo: el estudiante no ha matriculado generales todavía).
 */
async function resolverCursoGeneralParaSlot(
  idEstudiante: number,
  idCarrera: number,
  codigoSlot: string
): Promise<{ id_curso: number } | null> {
  const cursosCarrera = await prisma.curso_carrera.findMany({
    where: { id_carrera: idCarrera },
    include: { curso: true },
  });
  const historial = await prisma.historial_curso.findMany({
    where: { id_estudiante: idEstudiante },
  });
  const historialPorCurso = new Map(historial.map((h) => [h.id_curso, h]));

  const slotsLibres = cursosCarrera
    .map((cc) => cc.curso)
    .filter((c) => /^GEN\d+_/.test(c.codigo) && !historialPorCurso.has(c.id_curso))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));

  const generales = await prisma.curso.findMany({ where: { es_general: true } });
  const generalesCursados = generales
    .filter((g) => {
      const h = historialPorCurso.get(g.id_curso);
      return h && (h.estado === "aprobado" || h.estado === "cursando");
    })
    .sort((a, b) => {
      const estadoA = historialPorCurso.get(a.id_curso)!.estado;
      const estadoB = historialPorCurso.get(b.id_curso)!.estado;
      if (estadoA !== estadoB) return estadoA === "aprobado" ? -1 : 1;
      return a.codigo.localeCompare(b.codigo);
    });

  const idx = slotsLibres.findIndex((s) => s.codigo === codigoSlot);
  if (idx === -1 || idx >= generalesCursados.length) return null;
  return generalesCursados[idx];
}

// -----------------------------------------------------------------------
// Asignación explícita de curso real a un slot de malla (GEN{n}/OPT{n})
// -----------------------------------------------------------------------

export interface OpcionCatalogo {
  codigo: string;
  nombre: string;
  creditos: string;
}

export type OpcionesSlotResponse =
  | {
      estado: "disponible";
      tipo: "GEN" | "OPT";
      actuales: number;
      maximo: number;
      seleccionActual: string | null;
      opciones: OpcionCatalogo[];
    }
  | {
      estado: "tope_alcanzado";
      tipo: "GEN" | "OPT";
      maximo: number;
      mensaje: string;
    };

function tipoDeSlot(codigoSlot: string): "GEN" | "OPT" | null {
  if (/^GEN\d+_/.test(codigoSlot)) return "GEN";
  if (/^OPT\d+_/.test(codigoSlot)) return "OPT";
  return null;
}

/**
 * Cuenta cuántos slots GEN/OPT tiene hoy el estudiante con un curso real
 * asignado (id_slot_malla no nulo, estado aprobado/cursando) y el tope
 * correspondiente. GEN siempre son 4 (confirmado en las 5 carreras vía
 * PLANES_DE_ESTUDIO.xlsx); OPT se cuenta dinámicamente sobre curso_carrera
 * de la carrera del estudiante -- nunca hardcodeado, varía por carrera
 * (ISI: 4, Enseñanza del Inglés: 3, Topografía y Catastro: 4, Ciencia de
 * Datos: 3, Administración: 4).
 */
async function contarSlotsUsados(
  idEstudiante: number,
  idCarrera: number,
  tipo: "GEN" | "OPT"
): Promise<{ actuales: number; maximo: number }> {
  const actuales = await prisma.historial_curso.count({
    where: {
      id_estudiante: idEstudiante,
      estado: { in: ["aprobado", "cursando"] },
      slot_malla: { codigo: { startsWith: tipo } },
    },
  });

  if (tipo === "GEN") return { actuales, maximo: 4 };

  const maximo = await prisma.curso_carrera.count({
    where: { id_carrera: idCarrera, curso: { es_optativo: true } },
  });
  return { actuales, maximo };
}

/**
 * Opciones disponibles para llenar un slot GEN{n}/OPT{n}: el catálogo de
 * cursos reales del tipo correspondiente (es_general=true para GEN;
 * ciclo_id='Opt' AND es_optativo=false para OPT -- ver excel_loader.py),
 * excluyendo los que el estudiante ya tiene en su historial (no se puede
 * reusar el mismo curso real en dos slots). Si el slot ya tiene una
 * asignación propia, se informa en seleccionActual para que el Sheet
 * pueda preseleccionarla al reabrir en modo "editar".
 */
export async function obtenerOpcionesParaSlot(
  carnet: string,
  slotCodigo: string
): Promise<OpcionesSlotResponse> {
  const estudiante = await prisma.estudiante.findUnique({ where: { carnet } });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }

  const slot = await prisma.curso.findUnique({ where: { codigo: slotCodigo } });
  const tipo = tipoDeSlot(slotCodigo);
  if (!slot || !tipo) {
    throw new SlotInvalidoError(`${slotCodigo} no es un slot de Generales/Optativas`);
  }

  const { actuales, maximo } = await contarSlotsUsados(
    estudiante.id_estudiante,
    estudiante.id_carrera,
    tipo
  );

  const asignacionActual = await prisma.historial_curso.findFirst({
    where: { id_estudiante: estudiante.id_estudiante, id_slot_malla: slot.id_curso },
    include: { curso: true },
  });

  if (actuales >= maximo && !asignacionActual) {
    return {
      estado: "tope_alcanzado",
      tipo,
      maximo,
      mensaje:
        tipo === "GEN"
          ? `Ya completaste tus ${maximo} Estudios Generales`
          : `Ya completaste tus ${maximo} optativas`,
    };
  }

  const historial = await prisma.historial_curso.findMany({
    where: { id_estudiante: estudiante.id_estudiante },
  });
  const idsCursosUsados = new Set(historial.map((h) => h.id_curso));

  const catalogo =
    tipo === "GEN"
      ? await prisma.curso.findMany({ where: { es_general: true }, orderBy: { codigo: "asc" } })
      : await prisma.curso.findMany({
          // id_carrera: las electivas concretas (ej. EIF420O de ISI,
          // TDC102O de Ciencia de Datos) están acotadas a su carrera --
          // sin este filtro, el catálogo mezclaba las de todas las
          // carreras (confirmado contra la BD real, cada código *O trae
          // su id_carrera propio desde el Excel de origen).
          where: {
            ciclo_id: "Opt",
            es_optativo: false,
            es_general: false,
            id_carrera: estudiante.id_carrera,
          },
          orderBy: { nombre: "asc" },
        });

  const opciones = catalogo
    .filter((c) => !idsCursosUsados.has(c.id_curso) || c.id_curso === asignacionActual?.id_curso)
    .map((c) => ({ codigo: c.codigo, nombre: c.nombre, creditos: c.creditos.toString() }));

  return {
    estado: "disponible",
    tipo,
    actuales,
    maximo,
    seleccionActual: asignacionActual?.curso.codigo ?? null,
    opciones,
  };
}

/**
 * Crea un curso "manual" para la opción "Otro" del Sheet: el estudiante
 * solo ingresa el nombre (nunca va a recordar un código de Banner), así
 * que se genera un código interno provisional único y se marca
 * verificado=false para que quede distinguible en reportes de calidad
 * de datos -- no es un dato verificado contra Banner/Excel como el resto
 * del catálogo.
 */
async function crearCursoManual(
  nombre: string,
  tipo: "GEN" | "OPT",
  idEstudiante: number
): Promise<{ id_curso: number }> {
  // curso.codigo es VARCHAR(20) -- formato fijo para no excederlo nunca:
  // "GENM_" (5) + estudiante mod 1000 (3) + "_" (1) + epoch mod 1e10 (10)
  // + 1 char al azar (desempate si dos creaciones caen en el mismo ms
  // para el mismo estudiante mod 1000) = 20 exactos.
  const sufijoEstudiante = String(idEstudiante % 1000).padStart(3, "0");
  const sufijoTiempo = String(Date.now() % 10_000_000_000).padStart(10, "0");
  const azar = Math.floor(Math.random() * 36).toString(36);
  const codigo = `${tipo}M_${sufijoEstudiante}_${sufijoTiempo}${azar}`;
  return prisma.curso.create({
    data: {
      codigo,
      nombre: nombre.trim(),
      creditos: 0,
      id_carrera: null,
      es_general: tipo === "GEN",
      es_optativo: false,
      verificado: false,
      creditos_fuente: "manual",
      ciclo_id: "Opt",
      ciclo_nombre: "Optativos",
    },
    select: { id_curso: true },
  });
}

/**
 * Asigna explícitamente un curso real (del catálogo, o creado a mano vía
 * "Otro") a un slot GEN{n}/OPT{n} del estudiante -- reemplaza el
 * emparejamiento heurístico por orden con una asociación persistida en
 * id_slot_malla. Backend es la fuente de verdad del tope: se revalida acá
 * aunque el frontend ya haya filtrado, porque una carrera concurrente
 * (dos tabs) o datos desincronizados no deben poder saltarse el máximo
 * real de 4 generales / N optativas de la carrera.
 */
export async function asignarCursoRealASlot(
  carnet: string,
  slotCodigo: string,
  seleccion: { cursoRealCodigo: string } | { cursoRealNombre: string }
): Promise<void> {
  const estudiante = await prisma.estudiante.findUnique({ where: { carnet } });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }

  const slot = await prisma.curso.findUnique({ where: { codigo: slotCodigo } });
  const tipo = tipoDeSlot(slotCodigo);
  if (!slot || !tipo) {
    throw new SlotInvalidoError(`${slotCodigo} no es un slot de Generales/Optativas`);
  }

  const { actuales, maximo } = await contarSlotsUsados(
    estudiante.id_estudiante,
    estudiante.id_carrera,
    tipo
  );
  const yaAsignadoAEsteSlot = await prisma.historial_curso.findFirst({
    where: { id_estudiante: estudiante.id_estudiante, id_slot_malla: slot.id_curso },
  });
  if (actuales >= maximo && !yaAsignadoAEsteSlot) {
    throw new TopeSlotsAlcanzadoError(
      tipo === "GEN"
        ? `Ya completaste tus ${maximo} Estudios Generales`
        : `Ya completaste tus ${maximo} optativas`
    );
  }

  let cursoReal: { id_curso: number };
  if ("cursoRealCodigo" in seleccion) {
    const encontrado = await prisma.curso.findUnique({
      where: { codigo: seleccion.cursoRealCodigo },
    });
    const esDelCatalogoCorrecto =
      tipo === "GEN"
        ? encontrado?.es_general
        : encontrado?.ciclo_id === "Opt" &&
          !encontrado.es_optativo &&
          !encontrado.es_general &&
          encontrado.id_carrera === estudiante.id_carrera;
    if (!encontrado || !esDelCatalogoCorrecto) {
      throw new CursoNoEncontradoError(
        `${seleccion.cursoRealCodigo} no es una opción válida para este slot`
      );
    }
    cursoReal = encontrado;
  } else {
    cursoReal = await crearCursoManual(seleccion.cursoRealNombre, tipo, estudiante.id_estudiante);
  }

  const yaUsadoEnOtroSlot = await prisma.historial_curso.findUnique({
    where: {
      id_estudiante_id_curso: {
        id_estudiante: estudiante.id_estudiante,
        id_curso: cursoReal.id_curso,
      },
    },
  });
  if (yaUsadoEnOtroSlot && yaUsadoEnOtroSlot.id_slot_malla !== slot.id_curso) {
    throw new CursoYaAsignadoAOtroSlotError(
      `Ese curso ya está asignado a otro slot de tu malla`
    );
  }

  await prisma.$transaction(async (tx) => {
    // Reabrir el Sheet y elegir un curso real DISTINTO al que ya llenaba
    // este slot: el único índice único parcial es (id_estudiante,
    // id_slot_malla), así que hay que soltar esa marca de la fila vieja
    // ANTES de escribirla en la nueva -- si no, el upsert de abajo choca
    // contra su propio slot todavía ocupado (P2002). La fila vieja no se
    // borra: el curso real que representa sigue "aprobado" en el
    // historial, solo deja de estar atado a este slot puntual.
    if (yaAsignadoAEsteSlot && yaAsignadoAEsteSlot.id_curso !== cursoReal.id_curso) {
      await tx.historial_curso.update({
        where: { id_historial: yaAsignadoAEsteSlot.id_historial },
        data: { id_slot_malla: null },
      });
    }

    await tx.historial_curso.upsert({
      where: {
        id_estudiante_id_curso: {
          id_estudiante: estudiante.id_estudiante,
          id_curso: cursoReal.id_curso,
        },
      },
      create: {
        id_estudiante: estudiante.id_estudiante,
        id_curso: cursoReal.id_curso,
        id_slot_malla: slot.id_curso,
        estado: "aprobado",
      },
      update: {
        estado: "aprobado",
        id_slot_malla: slot.id_curso,
        actualizado_en: new Date(),
      },
    });
  });
}

/**
 * Desasigna el curso real de un slot GEN{n}/OPT{n} -- reemplaza al
 * DELETE /historial genérico para estos slots, que hoy no hace nada si el
 * slot no tiene una fila de historial PROPIA (el bug que este trabajo
 * corrige): busca primero por id_slot_malla (esquema nuevo) y si no
 * encuentra nada, cae al patrón legacy (id_curso = el propio placeholder,
 * filas de optativas nunca redirigidas antes de esta migración).
 */
export async function desasignarSlotMalla(carnet: string, slotCodigo: string): Promise<void> {
  const estudiante = await prisma.estudiante.findUnique({ where: { carnet } });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }

  const slot = await prisma.curso.findUnique({ where: { codigo: slotCodigo } });
  if (!slot || !tipoDeSlot(slotCodigo)) {
    throw new SlotInvalidoError(`${slotCodigo} no es un slot de Generales/Optativas`);
  }

  const fila = await prisma.historial_curso.findFirst({
    where: { id_estudiante: estudiante.id_estudiante, id_slot_malla: slot.id_curso },
  });
  if (fila) {
    await prisma.historial_curso.deleteMany({ where: { id_historial: fila.id_historial } });
    return;
  }

  await prisma.historial_curso.deleteMany({
    where: { id_estudiante: estudiante.id_estudiante, id_curso: slot.id_curso },
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

  // Un slot GEN{n} que todavía no tiene historial propio está siendo
  // mostrado con el estado autocompletado de un curso real de generales
  // (ver getMallaProgreso) -- togglearlo debe aprobar ese curso real, no
  // crear una fila aparte para el placeholder.
  let idCursoDestino = curso.id_curso;
  if (/^GEN\d+_/.test(codigoCurso)) {
    const historialPropio = await prisma.historial_curso.findUnique({
      where: {
        id_estudiante_id_curso: {
          id_estudiante: estudiante.id_estudiante,
          id_curso: curso.id_curso,
        },
      },
    });
    if (!historialPropio) {
      const cursoReal = await resolverCursoGeneralParaSlot(
        estudiante.id_estudiante,
        estudiante.id_carrera,
        codigoCurso
      );
      if (cursoReal) idCursoDestino = cursoReal.id_curso;
    }
  }

  await prisma.historial_curso.upsert({
    where: {
      id_estudiante_id_curso: {
        id_estudiante: estudiante.id_estudiante,
        id_curso: idCursoDestino,
      },
    },
    create: {
      id_estudiante: estudiante.id_estudiante,
      id_curso: idCursoDestino,
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

  // deleteMany, no delete: entre el findUnique de arriba y este punto,
  // un segundo click/request concurrente pudo haber borrado ya la misma
  // fila (P2025 "No record was found for a delete"). deleteMany no
  // lanza si el where no matchea nada -- mantiene la operación
  // idempotente de verdad, no solo en el caso donde nunca hubo fila.
  await prisma.historial_curso.deleteMany({
    where: {
      id_estudiante: estudiante.id_estudiante,
      id_curso: curso.id_curso,
    },
  });
}

// -----------------------------------------------------------------------
// Tipos de salida del endpoint GET /api/estudiantes/:carnet/secciones-cursando
// -----------------------------------------------------------------------

/**
 * Mismo shape que el tipo `Seccion` del frontend (ver
 * frontend/src/types/seccion.ts) -- a propósito, para que Mi Horario
 * pueda reusar el componente de calendario ya existente en Mis Cursos
 * sin necesitar un tipo ni un mapeo aparte.
 */
export interface SeccionCursando {
  nrc: string;
  codigoCurso: string;
  titulo: string;
  seccion: string;
  creditos: number;
  capacidad: number;
  inscritos: number;
  disponibles: number;
  estadoOferta: string;
  profesor: string;
  horarios: HorarioBloqueInfo[];
}

/**
 * Secciones confirmadas ("cursando") de un estudiante en un período, para
 * la pantalla Mi Horario -- independiente de Mis Cursos/oferta: lee directo
 * de historial_curso, no de la oferta del período, así que no
 * depende de que Banner siga publicando esas secciones para seguir
 * mostrándolas (un curso ya matriculado no debería desaparecer del
 * horario si Banner deja de listarlo).
 *
 * Un solo query con include (curso + seccion + profesor + horario_bloque)
 * -- sin N+1, a diferencia del patrón actual de Mis Cursos que resuelve
 * cada NRC con una llamada aparte a GET /horarios/nrc/:nrc.
 */
export async function getSeccionesCursando(
  carnet: string,
  codigoPeriodo?: string
): Promise<SeccionCursando[]> {
  const estudiante = await prisma.estudiante.findUnique({ where: { carnet } });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }
  // Acepta también un período finalizado si el estudiante tiene 'cursando'
  // en él (solo lectura en Mi Horario), ver resolveSchedulePeriod.
  const periodo = await resolveSchedulePeriod(codigoPeriodo, estudiante.id_estudiante);

  // Solo las matrículas de ESTE período: Mi Horario muestra el calendario
  // de un ciclo a la vez. confirmarMatricula siempre guarda id_periodo, y
  // las filas legacy sin período se backfillearon en V10.
  const historial = await prisma.historial_curso.findMany({
    where: {
      id_estudiante: estudiante.id_estudiante,
      estado: "cursando",
      id_periodo: periodo.id_periodo,
    },
    include: {
      curso: true,
      seccion: { include: { profesor: true, horario_bloque: true } },
    },
  });

  // En la práctica toda fila "cursando" tiene sección (confirmarMatricula
  // siempre la setea) -- se filtra igual por si acaso, en vez de asumirlo
  // y reventar con un curso sin horario que mostrar.
  return historial
    .filter((h) => h.seccion !== null)
    .map((h) => {
      const seccion = h.seccion!;
      return {
        nrc: seccion.nrc,
        codigoCurso: h.curso.codigo,
        titulo: h.curso.nombre,
        seccion: seccion.numero_seccion,
        creditos: Number(h.curso.creditos),
        capacidad: seccion.capacidad,
        inscritos: seccion.inscritos,
        disponibles: seccion.disponibles,
        estadoOferta: seccion.estado_oferta,
        profesor: seccion.profesor?.nombre ?? "",
        horarios: seccion.horario_bloque.map((bloque) => ({
          dia: bloque.dia,
          horaInicio: formatHora(bloque.hora_inicio),
          horaFin: formatHora(bloque.hora_fin),
          aula: bloque.aula,
        })),
      };
    });
}

/**
 * Períodos que Mi Horario ofrece en su selector: activos más los
 * finalizados donde el estudiante todavía tiene cursos 'cursando'.
 */
export async function getPeriodosHorario(carnet: string): Promise<PeriodoHorario[]> {
  const estudiante = await prisma.estudiante.findUnique({ where: { carnet } });
  if (!estudiante) {
    throw new EstudianteNoEncontradoError(`No existe un estudiante con carnet ${carnet}`);
  }
  return listSchedulePeriods(estudiante.id_estudiante);
}

import { prisma } from "../db";

/**
 * Un curso dentro de un ciclo de la malla.
 */
export interface CurriculumCourse {
  code: string;
  name: string;
  credits: number;
  isElective: boolean;
}

/**
 * Un ciclo de la malla (ej. "Ciclo 1", "Ciclo Opt") con sus cursos.
 */
export interface CurriculumCycle {
  cycleId: string;
  cycleName: string;
  courses: CurriculumCourse[];
}

/**
 * La malla completa de una carrera, agrupada por ciclo.
 */
export interface Curriculum {
  programId: number;
  programName: string;
  programAcronym: string;
  cycles: CurriculumCycle[];
}

/**
 * Nombres de despliegue "canónicos" por ciclo_id, para corregir una
 * inconsistencia real de datos: el ciclo optativo aparece en la BD
 * con ciclo_id = "Opt" pero con dos valores distintos de ciclo_nombre
 * según la corrida del scraper ("Ciclo Opt" vs "Optativos"), aunque
 * en la malla real (ver botsrb.info) es un único bloque "Optativos".
 * Si ciclo_id no aparece en este mapa, se usa el ciclo_nombre tal
 * como viene de la BD (fallback seguro para ciclos regulares "N M",
 * que sí son consistentes).
 */
const CYCLE_NAME_OVERRIDES: Record<string, string> = {
  Opt: "Optativos",
};

/**
 * Compara dos ciclo_id para ordenarlos correctamente.
 * Formato real observado: "AÑO CICLO" (ej. "1 1", "1 2", "2 1"...),
 * más el caso especial "Opt" que siempre va al final.
 */
function compareCycleIds(a: string, b: string): number {
  if (a === "Opt") return 1;
  if (b === "Opt") return -1;

  const [yearA, termA] = a.split(" ").map(Number);
  const [yearB, termB] = b.split(" ").map(Number);

  if (yearA !== yearB) return (yearA ?? 0) - (yearB ?? 0);
  return (termA ?? 0) - (termB ?? 0);
}

/**
 * Construye la malla curricular completa de una carrera, agrupada por
 * ciclo_id (columna agregada en la migración V2). El nombre mostrado
 * de cada ciclo se normaliza vía CYCLE_NAME_OVERRIDES cuando aplica,
 * para no depender de un ciclo_nombre inconsistente en los datos.
 *
 * Corresponde a GET /api/mallas/{carrera}, donde {carrera} es la sigla
 * de la carrera (ej. "isi", "itecad", "topo"), no su id numérico --
 * es más natural para quien consume la API que no necesite conocer
 * el id interno de antemano.
 *
 * @param programAcronym  sigla de la carrera, ej. "isi"
 * @returns la malla agrupada por ciclo, o null si la carrera no existe.
 */
export async function getCurriculumByProgram(
  programAcronym: string
): Promise<Curriculum | null> {
  const program = await prisma.carrera.findUnique({
    where: { sigla: programAcronym },
    include: {
      curso: {
        orderBy: { codigo: "asc" },
      },
    },
  });

  if (!program) {
    return null;
  }

  // Se agrupa en un Map para preservar el orden de inserción y evitar
  // duplicar la búsqueda de cada ciclo; luego se convierte a array.
  const cycleMap = new Map<string, CurriculumCycle>();

  for (const course of program.curso) {
    let cycle = cycleMap.get(course.ciclo_id);

    if (!cycle) {
      cycle = {
        cycleId: course.ciclo_id,
        cycleName: CYCLE_NAME_OVERRIDES[course.ciclo_id] ?? course.ciclo_nombre,
        courses: [],
      };
      cycleMap.set(course.ciclo_id, cycle);
    }

    cycle.courses.push({
      code: course.codigo,
      name: course.nombre,
      credits: Number(course.creditos),
      isElective: course.es_optativo,
    });
  }

  // Orden real observado en los datos: "1 1", "1 2", "2 1", ... "4 2", "Opt".
  // Se parsea "AÑO CICLO" a números para un orden correcto (evita que un
  // futuro "10 1" quede mal ubicado por comparación de texto), y "Opt"
  // siempre se coloca al final, como aparece en la malla real.
  const cycles = Array.from(cycleMap.values()).sort((a, b) =>
    compareCycleIds(a.cycleId, b.cycleId)
  );

  return {
    programId: program.id_carrera,
    programName: program.nombre,
    programAcronym: program.sigla,
    cycles,
  };
}
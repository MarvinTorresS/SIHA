/**
 * Detección de conflictos de horario --- lógica pura, sin dependencia
 * de Prisma ni de Express. Recibe listas de bloques horarios ya
 * resueltos (quien llama es responsable de traerlos desde
 * horario_bloque vía Prisma) y determina si existe solapamiento.
 *
 * Regla de negocio confirmada: dos bloques chocan solo si son el
 * mismo día y sus rangos de hora se solapan en un intervalo abierto
 * -- bordes que se tocan (ej. 10:00-13:00 y 13:00-16:20) NO se
 * consideran conflicto.
 *
 * Aplica tanto para cursos regulares (sección fija asignada
 * institucionalmente) como para optativos/adelantos (secciones
 * elegidas manualmente por el estudiante): el input siempre es "una
 * lista de secciones", sin importar cómo se armó esa lista.
 */

/** Un bloque horario tal como viene de la tabla horario_bloque. */
export interface HorarioBlock {
  dia: string; // "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"
  horaInicio: string; // TIME de Postgres, formato "HH:MM" o "HH:MM:SS"
  horaFin: string;
}

/** Una sección con su lista de bloques horarios e identificación. */
export interface SectionSchedule {
  codigoCurso: string;
  nrc: string; // identificador de sección (CRN de Banner)
  bloques: HorarioBlock[];
}

/** Un conflicto puntual entre dos bloques de dos secciones distintas. */
export interface ScheduleConflict {
  seccionA: { codigoCurso: string; nrc: string };
  seccionB: { codigoCurso: string; nrc: string };
  dia: string;
  bloqueA: HorarioBlock;
  bloqueB: HorarioBlock;
}

/** Resultado de validar una lista completa de secciones. */
export interface ValidationResult {
  tieneConflictos: boolean;
  conflictos: ScheduleConflict[];
}

/**
 * Convierte "HH:MM" o "HH:MM:SS" a minutos desde medianoche, para
 * poder comparar horas numéricamente sin ambigüedad de formato.
 */
function timeToMinutes(hora: string): number {
  const [horas, minutos] = hora.split(":").map(Number);
  return horas * 60 + minutos;
}

/**
 * Determina si dos bloques horarios chocan entre sí.
 * Deben ser el mismo día y sus rangos deben solaparse estrictamente
 * -- bordes que se tocan no cuentan como choque.
 */
export function blocksOverlap(a: HorarioBlock, b: HorarioBlock): boolean {
  if (a.dia !== b.dia) {
    return false;
  }

  const inicioA = timeToMinutes(a.horaInicio);
  const finA = timeToMinutes(a.horaFin);
  const inicioB = timeToMinutes(b.horaInicio);
  const finB = timeToMinutes(b.horaFin);

  return inicioA < finB && finA > inicioB;
}

/**
 * Recibe una lista de secciones (cada una con sus bloques horarios) y
 * devuelve todos los conflictos encontrados entre pares de secciones
 * distintas. No compara una sección contra sí misma.
 */
export function findScheduleConflicts(
  secciones: SectionSchedule[]
): ScheduleConflict[] {
  const conflictos: ScheduleConflict[] = [];

  for (let i = 0; i < secciones.length; i++) {
    for (let j = i + 1; j < secciones.length; j++) {
      const seccionA = secciones[i];
      const seccionB = secciones[j];

      for (const bloqueA of seccionA.bloques) {
        for (const bloqueB of seccionB.bloques) {
          if (blocksOverlap(bloqueA, bloqueB)) {
            conflictos.push({
              seccionA: {
                codigoCurso: seccionA.codigoCurso,
                nrc: seccionA.nrc,
              },
              seccionB: {
                codigoCurso: seccionB.codigoCurso,
                nrc: seccionB.nrc,
              },
              dia: bloqueA.dia,
              bloqueA,
              bloqueB,
            });
          }
        }
      }
    }
  }

  return conflictos;
}

/**
 * Punto de entrada de alto nivel para el endpoint de validación
 * (ej. POST /api/horarios/validar): valida una lista de secciones y
 * devuelve si hay conflictos junto con el detalle de cada uno.
 */
export function validateSchedule(
  secciones: SectionSchedule[]
): ValidationResult {
  const conflictos = findScheduleConflicts(secciones);
  return {
    tieneConflictos: conflictos.length > 0,
    conflictos,
  };
}
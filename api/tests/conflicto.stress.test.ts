import { describe, it, expect } from "vitest";
import {
  blocksOverlap,
  findScheduleConflicts,
  type SectionSchedule,
  type HorarioBlock,
} from "../src/services/conflicto.service";

/**
 * Stress test del ConflictDetector.
 *
 * Escenario: un estudiante con 8 cursos (típico de un ciclo completo
 * en ISI/ITECAD/TOPO), cada uno con 2 bloques horarios (ej. teoría +
 * laboratorio). El detector debe procesar todas las comparaciones
 * O(n²) entre bloques en <500 ms.
 *
 * Se usa la regla confirmada: mismo día + solapamiento estricto
 * (bordes tocándose no chocan).
 */

function makeBlock(
  dia: string,
  horaInicio: string,
  horaFin: string
): HorarioBlock {
  return { dia, horaInicio, horaFin };
}

function makeSection(
  codigoCurso: string,
  nrc: string,
  bloques: HorarioBlock[]
): SectionSchedule {
  return { codigoCurso, nrc, bloques };
}

describe("ConflictDetector — Stress test", () => {
  it("procesa 8 cursos (16 bloques) sin conflicto en <500 ms", () => {
    // 8 cursos, cada uno en un día y horario distinto (sin conflicto)
    const secciones: SectionSchedule[] = [
      makeSection("EIF200", "50001", [makeBlock("Lunes", "07:00", "08:40")]),
      makeSection("EIF201", "50002", [makeBlock("Lunes", "09:00", "11:30")]),
      makeSection("EIF203", "50003", [makeBlock("Martes", "07:00", "08:40")]),
      makeSection("EIF204", "50004", [makeBlock("Martes", "09:00", "11:30")]),
      makeSection("EIF205", "50005", [makeBlock("Miércoles", "07:00", "08:40")]),
      makeSection("EIF206", "50006", [makeBlock("Miércoles", "09:00", "11:30")]),
      makeSection("EIF207", "50007", [makeBlock("Jueves", "07:00", "08:40")]),
      makeSection("MAT002", "50008", [makeBlock("Jueves", "09:00", "11:30")]),
    ];

    const start = performance.now();
    const conflictos = findScheduleConflicts(secciones);
    const elapsed = performance.now() - start;

    expect(conflictos).toHaveLength(0);
    expect(elapsed).toBeLessThan(500);
  });

  it("procesa 8 cursos (16 bloques) con múltiples conflictos en <500 ms", () => {
    // 8 cursos, varios en el mismo día y horario (máximo conflicto)
    const secciones: SectionSchedule[] = [
      makeSection("EIF200", "50001", [makeBlock("Lunes", "07:00", "08:40")]),
      makeSection("EIF201", "50002", [makeBlock("Lunes", "07:00", "08:40")]), // choca con EIF200
      makeSection("EIF203", "50003", [makeBlock("Lunes", "07:00", "08:40")]), // choca con ambos
      makeSection("EIF204", "50004", [makeBlock("Lunes", "07:00", "08:40")]), // choca con todos
      makeSection("EIF205", "50005", [
        makeBlock("Martes", "08:00", "10:00"),
        makeBlock("Jueves", "13:00", "15:00"),
      ]),
      makeSection("EIF206", "50006", [
        makeBlock("Martes", "08:00", "10:00"), // choca con EIF205
        makeBlock("Jueves", "13:00", "15:00"), // choca con EIF205
      ]),
      makeSection("EIF207", "50007", [makeBlock("Viernes", "07:00", "08:40")]),
      makeSection("MAT002", "50008", [makeBlock("Viernes", "09:00", "11:30")]),
    ];

    const start = performance.now();
    const conflictos = findScheduleConflicts(secciones);
    const elapsed = performance.now() - start;

    // 4 cursos en lunes mismo horario → C(4,2) = 6 conflictos
    // 2 cursos en martes mismo horario → C(2,2) = 1 conflicto (pero EIF205 y EIF206 tienen 2 bloques cada uno,
    //   y ambos chocan en martes y jueves → 2 conflictos)
    // Total esperado: 6 + 2 = 8 conflictos
    expect(conflictos.length).toBeGreaterThanOrEqual(8);
    expect(elapsed).toBeLessThan(500);
  });

  it("los bordes que se tocan no generan conflicto", () => {
    const secciones: SectionSchedule[] = [
      makeSection("EIF200", "50001", [makeBlock("Lunes", "08:00", "10:00")]),
      makeSection("EIF201", "50002", [makeBlock("Lunes", "10:00", "12:00")]), // toca justo al terminar
    ];

    const conflictos = findScheduleConflicts(secciones);
    expect(conflictos).toHaveLength(0);
  });

  it("procesa un caso extremo de 50 secciones en <500 ms", () => {
    const secciones: SectionSchedule[] = [];
    for (let i = 0; i < 50; i++) {
      secciones.push(
        makeSection(`CURSO${i}`, `NRC${i}`, [
          makeBlock("Lunes", "07:00", "08:00"),
          makeBlock("Martes", "08:00", "09:00"),
        ])
      );
    }

    const start = performance.now();
    const conflictos = findScheduleConflicts(secciones);
    const elapsed = performance.now() - start;

    // 50 cursos, todos chocan en lunes y martes
    // C(50,2) = 1225 pares × 2 bloques = 2450 conflictos
    expect(conflictos.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(500);
  });
});
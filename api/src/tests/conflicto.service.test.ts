import { describe, it, expect } from "vitest";
import {
  blocksOverlap,
  findScheduleConflicts,
  validateSchedule,
  type SectionSchedule,
} from "../services/conflicto.service";

describe("blocksOverlap", () => {
  it("no choca si son días distintos, aunque la hora se solape", () => {
    const a = { dia: "Lunes", horaInicio: "10:00", horaFin: "13:00" };
    const b = { dia: "Martes", horaInicio: "10:00", horaFin: "13:00" };
    expect(blocksOverlap(a, b)).toBe(false);
  });

  it("no choca si los bordes se tocan exactamente (mismo día)", () => {
    const a = { dia: "Lunes", horaInicio: "10:00", horaFin: "13:00" };
    const b = { dia: "Lunes", horaInicio: "13:00", horaFin: "16:20" };
    expect(blocksOverlap(a, b)).toBe(false);
  });

  it("choca si hay solapamiento parcial (mismo día)", () => {
    const a = { dia: "Viernes", horaInicio: "13:00", horaFin: "16:20" };
    const b = { dia: "Viernes", horaInicio: "15:00", horaFin: "18:00" };
    expect(blocksOverlap(a, b)).toBe(true);
  });

  it("choca si un bloque contiene completamente al otro", () => {
    const a = { dia: "Lunes", horaInicio: "08:00", horaFin: "17:00" };
    const b = { dia: "Lunes", horaInicio: "13:00", horaFin: "14:00" };
    expect(blocksOverlap(a, b)).toBe(true);
  });

  it("choca si son exactamente el mismo bloque", () => {
    const a = { dia: "Lunes", horaInicio: "13:00", horaFin: "16:20" };
    const b = { dia: "Lunes", horaInicio: "13:00", horaFin: "16:20" };
    expect(blocksOverlap(a, b)).toBe(true);
  });

  it("funciona con formato HH:MM:SS (TIME de Postgres)", () => {
    const a = { dia: "Lunes", horaInicio: "13:00:00", horaFin: "16:20:00" };
    const b = { dia: "Lunes", horaInicio: "15:00:00", horaFin: "18:00:00" };
    expect(blocksOverlap(a, b)).toBe(true);
  });
});

describe("findScheduleConflicts", () => {
  it("no reporta conflictos entre secciones sin solapamiento", () => {
    const secciones: SectionSchedule[] = [
      {
        codigoCurso: "EIF200",
        nrc: "50884",
        bloques: [{ dia: "Viernes", horaInicio: "13:00", horaFin: "16:20" }],
      },
      {
        codigoCurso: "MAT001",
        nrc: "50900",
        bloques: [{ dia: "Lunes", horaInicio: "08:00", horaFin: "10:00" }],
      },
    ];
    expect(findScheduleConflicts(secciones)).toHaveLength(0);
  });

  it("reporta un conflicto entre dos secciones con choque de horario", () => {
    const secciones: SectionSchedule[] = [
      {
        codigoCurso: "EIF200",
        nrc: "50884",
        bloques: [{ dia: "Viernes", horaInicio: "13:00", horaFin: "16:20" }],
      },
      {
        codigoCurso: "MAT001",
        nrc: "50900",
        bloques: [{ dia: "Viernes", horaInicio: "15:00", horaFin: "18:00" }],
      },
    ];
    const conflictos = findScheduleConflicts(secciones);
    expect(conflictos).toHaveLength(1);
    expect(conflictos[0].seccionA.codigoCurso).toBe("EIF200");
    expect(conflictos[0].seccionB.codigoCurso).toBe("MAT001");
    expect(conflictos[0].dia).toBe("Viernes");
  });

  it("no compara una sección con bloques múltiples contra sí misma", () => {
    const secciones: SectionSchedule[] = [
      {
        codigoCurso: "EIF200",
        nrc: "50884",
        bloques: [
          { dia: "Lunes", horaInicio: "13:00", horaFin: "16:20" },
          { dia: "Miércoles", horaInicio: "13:00", horaFin: "16:20" },
        ],
      },
    ];
    expect(findScheduleConflicts(secciones)).toHaveLength(0);
  });

  it("detecta conflicto cuando una sección tiene varios bloques y solo uno choca", () => {
    const secciones: SectionSchedule[] = [
      {
        codigoCurso: "EIF200",
        nrc: "50884",
        bloques: [
          { dia: "Lunes", horaInicio: "13:00", horaFin: "16:20" },
          { dia: "Miércoles", horaInicio: "13:00", horaFin: "16:20" },
        ],
      },
      {
        codigoCurso: "MAT001",
        nrc: "50900",
        bloques: [{ dia: "Miércoles", horaInicio: "14:00", horaFin: "15:00" }],
      },
    ];
    const conflictos = findScheduleConflicts(secciones);
    expect(conflictos).toHaveLength(1);
    expect(conflictos[0].dia).toBe("Miércoles");
  });

  it("detecta múltiples conflictos entre más de dos secciones", () => {
    const secciones: SectionSchedule[] = [
      {
        codigoCurso: "A",
        nrc: "1",
        bloques: [{ dia: "Lunes", horaInicio: "08:00", horaFin: "10:00" }],
      },
      {
        codigoCurso: "B",
        nrc: "2",
        bloques: [{ dia: "Lunes", horaInicio: "09:00", horaFin: "11:00" }],
      },
      {
        codigoCurso: "C",
        nrc: "3",
        bloques: [{ dia: "Lunes", horaInicio: "09:30", horaFin: "10:30" }],
      },
    ];
    // A-B chocan, A-C chocan, B-C chocan => 3 conflictos
    expect(findScheduleConflicts(secciones)).toHaveLength(3);
  });
});

describe("validateSchedule", () => {
  it("tieneConflictos = false cuando no hay choques", () => {
    const secciones: SectionSchedule[] = [
      {
        codigoCurso: "EIF200",
        nrc: "50884",
        bloques: [{ dia: "Viernes", horaInicio: "13:00", horaFin: "16:20" }],
      },
    ];
    const resultado = validateSchedule(secciones);
    expect(resultado.tieneConflictos).toBe(false);
    expect(resultado.conflictos).toHaveLength(0);
  });

  it("tieneConflictos = true cuando hay al menos un choque", () => {
    const secciones: SectionSchedule[] = [
      {
        codigoCurso: "EIF200",
        nrc: "50884",
        bloques: [{ dia: "Viernes", horaInicio: "13:00", horaFin: "16:20" }],
      },
      {
        codigoCurso: "MAT001",
        nrc: "50900",
        bloques: [{ dia: "Viernes", horaInicio: "15:00", horaFin: "18:00" }],
      },
    ];
    const resultado = validateSchedule(secciones);
    expect(resultado.tieneConflictos).toBe(true);
    expect(resultado.conflictos).toHaveLength(1);
  });
});
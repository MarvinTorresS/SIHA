/**
 * Tipos para GET/POST/DELETE /api/estudiantes/{carnet}/malla-slots/{slotCodigo} --
 * ver obtenerOpcionesParaSlot/asignarCursoRealASlot en estudiante.service.ts (backend).
 */

export interface OpcionCatalogo {
  codigo: string
  nombre: string
  creditos: string
}

export type OpcionesSlotResponse =
  | {
      estado: "disponible"
      tipo: "GEN" | "OPT"
      actuales: number
      maximo: number
      /** Código del curso real ya asignado a este slot, si lo hay -- para preseleccionar al reabrir. */
      seleccionActual: string | null
      opciones: OpcionCatalogo[]
    }
  | {
      estado: "tope_alcanzado"
      tipo: "GEN" | "OPT"
      maximo: number
      mensaje: string
    }

export type SeleccionCursoReal =
  | { cursoRealCodigo: string }
  | { cursoRealNombre: string }

import type { Response } from "express";
import { PeriodoInvalidoError, SinPeriodosActivosError } from "../services/periodo.service";

/**
 * Traduce los errores de resolución de período a HTTP. Devuelve true si
 * el error era de período (y ya se respondió), false si no lo era.
 */
export function respondPeriodError(err: unknown, res: Response): boolean {
  if (err instanceof PeriodoInvalidoError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof SinPeriodosActivosError) {
    // Error de configuración de datos, no del cliente -> 500.
    res.status(500).json({ error: err.message });
    return true;
  }
  return false;
}

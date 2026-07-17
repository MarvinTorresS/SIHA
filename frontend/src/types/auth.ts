import type { CarreraSigla, Estudiante } from "./academico"

export interface RegistroRequest {
  carnet: string
  nombre: string
  correo: string
  password: string
  carreraSigla: CarreraSigla
}

export interface LoginRequest {
  carnet: string
  password: string
}

/** Respuesta de POST /api/auth/registro y POST /api/auth/login. */
export interface SesionResponse {
  token: string
  estudiante: Estudiante
}

/** Respuesta de GET /api/auth/me. */
export interface MeResponse {
  estudiante: Estudiante
}

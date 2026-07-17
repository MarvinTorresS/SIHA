import { api } from "./api"
import type { RegistroRequest, LoginRequest, SesionResponse, MeResponse } from "@/types/auth"

export const authService = {
  /** POST /api/auth/registro */
  registrar(datos: RegistroRequest) {
    return api.post<SesionResponse>("/auth/registro", datos)
  },
  /** POST /api/auth/login */
  login(datos: LoginRequest) {
    return api.post<SesionResponse>("/auth/login", datos)
  },
  /** GET /api/auth/me -- hidrata la sesión desde el token guardado. */
  me() {
    return api.get<MeResponse>("/auth/me")
  },
}

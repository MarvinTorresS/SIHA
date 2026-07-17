const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api"

/** Key de localStorage para el JWT -- fuente única, la usan api.ts y authStore.ts. */
export const TOKEN_STORAGE_KEY = "siha-token"

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

/**
 * Wrapper mínimo sobre fetch para la API de SIHA.
 * Lanza ApiError en respuestas no-2xx, para que los servicios y
 * componentes puedan hacer try/catch de forma consistente. Adjunta el
 * JWT guardado en localStorage (si existe) a toda request -- las rutas
 * públicas (auth/registro, auth/login) simplemente lo ignoran del lado
 * del servidor.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)

  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    ...init,
  })

  if (!res.ok) {
    let message = `Error ${res.status} al consultar ${path}`
    try {
      const body = await res.json()
      message = body?.message ?? body?.error ?? message
    } catch {
      // el cuerpo no era JSON, se mantiene el mensaje genérico
    }
    throw new ApiError(res.status, message)
  }

  // 204 No Content u otras respuestas sin cuerpo
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}

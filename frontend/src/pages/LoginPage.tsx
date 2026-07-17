import { useState } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useAuthStore } from "@/store/authStore"
import { ApiError } from "@/services/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"

export function LoginPage() {
  const estudiante = useAuthStore((s) => s.estudiante)
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const [carnet, setCarnet] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // Ya hay sesión (ej. llegó acá con el token todavía válido) -- no tiene
  // sentido mostrarle el formulario de nuevo.
  if (estudiante) return <Navigate to="/" replace />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setEnviando(true)
    try {
      await login({ carnet, password })
      navigate("/", { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo conectar con la API. ¿Está corriendo en localhost:3000?"
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-xs">
              UNA
            </div>
            <p className="text-sm font-semibold">SIHA</p>
          </div>
          <CardTitle>Iniciar sesión</CardTitle>
          <CardDescription>Campus Coto · Sistema de Horarios y Avance</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="carnet">Identificación</Label>
              <Input
                id="carnet"
                value={carnet}
                onChange={(e) => setCarnet(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? "Ingresando..." : "Ingresar"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              ¿Todavía no tenés cuenta?{" "}
              <Link to="/registro" className="font-medium text-primary hover:underline">
                Registrate
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

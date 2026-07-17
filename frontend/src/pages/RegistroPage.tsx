import { useState } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useAuthStore } from "@/store/authStore"
import { ApiError } from "@/services/api"
import { CARRERAS } from "@/types/academico"
import type { CarreraSigla } from "@/types/academico"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function RegistroPage() {
  const estudiante = useAuthStore((s) => s.estudiante)
  const registrar = useAuthStore((s) => s.registrar)
  const navigate = useNavigate()

  const [carnet, setCarnet] = useState("")
  const [nombre, setNombre] = useState("")
  const [correo, setCorreo] = useState("")
  const [password, setPassword] = useState("")
  const [carreraSigla, setCarreraSigla] = useState<CarreraSigla>("isi")
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  if (estudiante) return <Navigate to="/" replace />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres")
      return
    }

    setEnviando(true)
    try {
      await registrar({ carnet, nombre, correo, password, carreraSigla })
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
          <CardTitle>Crear cuenta</CardTitle>
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
              <Label htmlFor="nombre">Nombre completo</Label>
              <Input
                id="nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                autoComplete="name"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="correo">Correo institucional</Label>
              <Input
                id="correo"
                type="email"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="carrera">Carrera</Label>
              <Select
                value={carreraSigla}
                onValueChange={(v) => setCarreraSigla(v as CarreraSigla)}
              >
                <SelectTrigger id="carrera" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARRERAS.map((carrera) => (
                    <SelectItem key={carrera.sigla} value={carrera.sigla}>
                      {carrera.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
            </div>

            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? "Creando cuenta..." : "Crear cuenta"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              ¿Ya tenés cuenta?{" "}
              <Link to="/login" className="font-medium text-primary hover:underline">
                Iniciá sesión
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

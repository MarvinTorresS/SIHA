import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Search } from "lucide-react"
import { Header } from "@/components/layout/Header"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { CursoOfertaCard } from "@/components/mis-cursos/CursoOfertaCard"
import { CalendarioSemanal } from "@/components/mis-cursos/CalendarioSemanal"
import { useAuthStore } from "@/store/authStore"
import { useHorarioStore } from "@/store/horarioStore"
import { estudianteService } from "@/services/estudiante.service"
import { ApiError } from "@/services/api"
import { resolverArea } from "@/lib/curso-area"
import type { EstadoOferta } from "@/types/oferta"

const ESTADO_LABELS: Record<EstadoOferta, string> = {
  aprobado: "Aprobado",
  cursando: "Cursando",
  elegible: "Elegible",
  bloqueado: "Bloqueado",
}

// Elegible primero (lo único accionable sin filtrar nada) y bloqueado
// justo después (para saber qué falta); cursando/aprobado al final --
// ya están resueltos, no piden atención. Sin esto, la lista sale en
// orden alfabético de código y un estudiante tiene que bajar mucho o
// descubrir el filtro de estado para encontrar qué puede matricular.
const PRIORIDAD_ESTADO: Record<EstadoOferta, number> = {
  elegible: 0,
  bloqueado: 1,
  cursando: 2,
  aprobado: 3,
}

export function MisCursosPage() {
  const estudiante = useAuthStore((s) => s.estudiante)
  const queryClient = useQueryClient()

  const cargarSeccionesFijas = useHorarioStore((s) => s.cargarSeccionesFijas)
  const seccionesManuales = useHorarioStore((s) => s.seccionesManuales)
  const limpiarSeccionesManuales = useHorarioStore((s) => s.limpiarSeccionesManuales)

  const { data, isLoading, error } = useQuery({
    queryKey: ["oferta-ciclo", estudiante?.carnet],
    queryFn: () => estudianteService.obtenerOferta(estudiante!.carnet),
    enabled: !!estudiante,
  })

  // Los cursos "cursando" (ya matriculados institucionalmente, o recién
  // confirmados desde esta misma pantalla) se cargan como secciones fijas
  // del horario -- no son una elección editable acá.
  useEffect(() => {
    if (!data) return
    const nrcsCursando = data
      .filter((c) => c.estado === "cursando" && c.seccionActual)
      .map((c) => c.seccionActual!.nrc)
    cargarSeccionesFijas(nrcsCursando)
    // cargarSeccionesFijas es estable (Zustand); solo debe repetirse
    // cuando cambian los datos de la oferta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const invalidarOferta = () =>
    queryClient.invalidateQueries({ queryKey: ["oferta-ciclo", estudiante?.carnet] })

  const confirmarMatriculaMutation = useMutation({
    mutationFn: (nrcs: string[]) =>
      estudianteService.confirmarMatricula(estudiante!.carnet, nrcs),
    onSuccess: () => {
      // El borrador ya quedó escrito en la BD como "cursando" -- se
      // limpia el borrador local para que no se cuente dos veces (una
      // vez como manual, otra como fija) cuando refetch traiga los
      // mismos cursos ya con estado "cursando".
      limpiarSeccionesManuales()
      invalidarOferta()
    },
  })

  const quitarConfirmadoMutation = useMutation({
    mutationFn: (codigoCurso: string) =>
      estudianteService.quitarDelHistorial(estudiante!.carnet, codigoCurso),
    onSuccess: invalidarOferta,
  })

  const [busqueda, setBusqueda] = useState("")
  const [filtroEstado, setFiltroEstado] = useState<"todos" | EstadoOferta>("todos")
  const [filtroArea, setFiltroArea] = useState("todas")

  const areasDisponibles = useMemo(() => {
    if (!data) return []
    const areas = new Set(data.map((c) => resolverArea(c.codigo).label))
    return Array.from(areas).sort()
  }, [data])

  const cursosFiltrados = useMemo(() => {
    if (!data) return []
    const q = busqueda.trim().toLowerCase()
    return data
      .filter((c) => {
        if (filtroEstado !== "todos" && c.estado !== filtroEstado) return false
        if (filtroArea !== "todas" && resolverArea(c.codigo).label !== filtroArea) return false
        if (q && !c.codigo.toLowerCase().includes(q) && !c.nombre.toLowerCase().includes(q)) {
          return false
        }
        return true
      })
      .sort((a, b) => {
        const porEstado = PRIORIDAD_ESTADO[a.estado] - PRIORIDAD_ESTADO[b.estado]
        return porEstado !== 0 ? porEstado : a.codigo.localeCompare(b.codigo)
      })
  }, [data, busqueda, filtroEstado, filtroArea])

  return (
    <>
      <Header
        title="Mis Cursos"
        description={
          estudiante
            ? `${estudiante.carrera.nombre} · oferta del período activo`
            : undefined
        }
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            disabled={seccionesManuales.length === 0 || confirmarMatriculaMutation.isPending}
            onClick={() =>
              confirmarMatriculaMutation.mutate(seccionesManuales.map((s) => s.nrc))
            }
          >
            <CheckCircle2 className="size-4" />
            {confirmarMatriculaMutation.isPending
              ? "Confirmando..."
              : `Confirmar Matrícula${
                  seccionesManuales.length > 0 ? ` (${seccionesManuales.length})` : ""
                }`}
          </Button>
        }
      />
      <main className="flex-1 p-4 md:p-6">
        {confirmarMatriculaMutation.isError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              {confirmarMatriculaMutation.error instanceof ApiError
                ? confirmarMatriculaMutation.error.message
                : "No se pudo confirmar la matrícula. Intenta de nuevo."}
            </AlertDescription>
          </Alert>
        )}

        {quitarConfirmadoMutation.isError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              {quitarConfirmadoMutation.error instanceof ApiError
                ? quitarConfirmadoMutation.error.message
                : "No se pudo quitar el curso. Intenta de nuevo."}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[560px_1fr] gap-4 items-start">
          {/* Panel izquierdo: filtros + lista */}
          <div className="space-y-3 min-w-0">
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por código o nombre..."
                  className="pl-8"
                  aria-label="Buscar curso"
                />
              </div>

              <div className="flex gap-2">
                <Select
                  value={filtroEstado}
                  onValueChange={(v) => setFiltroEstado(v as "todos" | EstadoOferta)}
                >
                  <SelectTrigger className="flex-1" aria-label="Filtrar por estado">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los estados</SelectItem>
                    {(Object.keys(ESTADO_LABELS) as EstadoOferta[]).map((estado) => (
                      <SelectItem key={estado} value={estado}>
                        {ESTADO_LABELS[estado]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filtroArea} onValueChange={setFiltroArea}>
                  <SelectTrigger className="flex-1" aria-label="Filtrar por área">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas las áreas</SelectItem>
                    {areasDisponibles.map((area) => (
                      <SelectItem key={area} value={area}>
                        {area}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>
                  {import.meta.env.DEV
                    ? error instanceof ApiError
                      ? `${error.status}: ${error.message}`
                      : "No se pudo conectar con la API. ¿Está corriendo en localhost:3000?"
                    : "No pudimos cargar la oferta de cursos. Intenta de nuevo más tarde."}
                </AlertDescription>
              </Alert>
            )}

            {isLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...Array(6)].map((_, i) => (
                  <Card key={i}>
                    <CardContent className="p-3">
                      <Skeleton className="h-28 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {data && cursosFiltrados.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Ningún curso coincide con la búsqueda o los filtros.
              </p>
            )}

            {data && cursosFiltrados.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {cursosFiltrados.map((curso) => (
                  <CursoOfertaCard
                    key={curso.codigo}
                    curso={curso}
                    onQuitarConfirmado={(codigo) => quitarConfirmadoMutation.mutate(codigo)}
                    quitandoConfirmado={
                      quitarConfirmadoMutation.isPending &&
                      quitarConfirmadoMutation.variables === curso.codigo
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {/* Panel derecho: calendario, fijo y grande */}
          <div className="xl:sticky xl:top-20 min-w-0">
            <CalendarioSemanal />
          </div>
        </div>
      </main>
    </>
  )
}

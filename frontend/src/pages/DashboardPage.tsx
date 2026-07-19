import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import {
  TrendingUp,
  GraduationCap,
  CheckCircle2,
  Clock,
  ChevronRight,
  BookOpen,
  User,
  MapPin,
} from "lucide-react"
import { resolverArea, codigoVisible } from "@/lib/curso-area"
import { Header } from "@/components/layout/Header"
import { EstadoBadge } from "@/components/shared/EstadoBadge"
import { useAuthStore } from "@/store/authStore"
import { estudianteService } from "@/services/estudiante.service"
import { ApiError } from "@/services/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { CursoConProgreso } from "@/types/estudiante"

// -----------------------------------------------------------------------
// Estadísticas superiores
// -----------------------------------------------------------------------
// Sin ícono-en-tile (patrón marcado como cliché de SaaS en DESIGN.md,
// ya retirado en Malla Curricular): el ícono acompaña la etiqueta en
// línea en vez de vivir en un cuadro de color propio.

interface StatCardProps {
  icon: React.ElementType
  iconClassName: string
  value: string | number
  label: string
  sublabel: string
}

function StatCard({ icon: Icon, iconClassName, value, label, sublabel }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className={`flex items-center gap-1.5 ${iconClassName}`}>
          <Icon className="size-4" />
          <p className="text-xs font-medium">{label}</p>
        </div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      </CardContent>
    </Card>
  )
}


// -----------------------------------------------------------------------
// Card de curso matriculado
// -----------------------------------------------------------------------

function CursoMatriculadoCard({ curso }: { curso: CursoConProgreso }) {
  const esSinSeccion = curso.estado === "sin_seccion"
  const area = resolverArea(curso.codigo)

  return (
    <Card className={`border-t-4 ${area.borderClassName}`}>
      <CardContent className="p-4 space-y-3">
        {/* flex-wrap en la fila + min-w-0 en el grupo izquierdo: sin
            min-w-0, el div de badges no tiene piso de achique explícito
            y usa su min-content real como floor -- con el badge de área
            "Estudios generales" (el label más largo) eso puede seguir
            siendo más ancho que lo disponible en la card, y sin
            flex-wrap en la fila exterior no hay a dónde caer: el badge
            de estado (shrink-0 por Badge base) queda empujado fuera del
            borde derecho en vez de bajar a una línea nueva. */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-xs font-mono">
              {codigoVisible(curso.codigo)}
            </Badge>
            <Badge className={`text-xs ${area.badgeClassName} border-transparent`}>
              {area.label}
            </Badge>
          </div>
          <EstadoBadge estado={curso.estado} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-sm font-medium leading-tight">{curso.nombre}</p>
          <span className="text-xs text-muted-foreground shrink-0">
            {curso.creditos} cr
          </span>
        </div>

        {curso.seccion ? (
          <div className="space-y-1.5 pt-1 border-t border-border/60">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <BookOpen className="size-3.5 shrink-0" />
              <span>
                Sección {curso.seccion.numeroSeccion} · NRC{" "}
                <span className="font-mono">{curso.seccion.nrc}</span>
              </span>
            </div>
            {curso.seccion.profesor && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <User className="size-3.5 shrink-0" />
                <span className="truncate">{curso.seccion.profesor}</span>
              </div>
            )}
            {curso.seccion.horarios.map((h, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5 shrink-0" />
                <span>
                  {h.dia} {h.horaInicio}–{h.horaFin}
                  {h.aula && ` · ${h.aula}`}
                </span>
              </div>
            ))}
          </div>
        ) : esSinSeccion ? (
          <p className="text-xs text-muted-foreground pt-1 border-t border-border/60">
            Sin sección asignada este ciclo
          </p>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t border-border/60">
            <MapPin className="size-3.5 shrink-0" />
            <span>Sección no disponible aún</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// -----------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------

export function DashboardPage() {
  const estudiante = useAuthStore((s) => s.estudiante)

  const {
    data: progreso,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["malla-progreso", estudiante?.carnet],
    queryFn: () => estudianteService.obtenerMallaProgreso(estudiante!.carnet),
    enabled: !!estudiante,
  })

  const todosLosCursos = progreso?.semestres.flatMap((s) => s.cursos) ?? []
  // GEN{n}_{sigla} ("Estudios Generales I/II/III/IV") es un slot genérico
  // de la malla que la API autocompleta con el estado del curso real de
  // generales (ej. EGA121) que lo cubre -- ver getMallaProgreso. Un slot
  // en "cursando" SIEMPRE es ese autocompletado (nunca se matricula un
  // NRC real contra un código GEN*, no existe en Banner), así que
  // mostrarlo acá además del curso real que ya aparece sería la misma
  // matrícula duplicada. "sin_seccion" sí se deja: significa que el
  // slot de este ciclo todavía no está cubierto por ningún general real.
  const esSlotGeneralCubierto = (c: CursoConProgreso) =>
    /^GEN\d+_/.test(c.codigo) && c.estado === "cursando"
  const cursosMatriculados = todosLosCursos.filter(
    (c) => (c.estado === "cursando" || c.estado === "sin_seccion") && !esSlotGeneralCubierto(c)
  )
  const creditosCicloActual = cursosMatriculados.reduce(
    (sum, c) => sum + Number(c.creditos),
    0
  )
  const porcentajeAprobado = progreso
    ? Math.round(
        (progreso.resumen.creditosAprobados /
          progreso.resumen.creditosTotalesCarrera) *
          100
      )
    : 0

  const semestresCompletados =
    progreso?.semestres.filter(
      (s) => s.cursos.length > 0 && s.cursos.every((c) => c.estado === "aprobado")
    ).length ?? 0

  return (
    <>
      <Header
        title="Dashboard"
        description={estudiante?.carrera.nombre}
      />
      <main className="flex-1 p-4 md:p-6 space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error instanceof ApiError
                ? `${error.status}: ${error.message}`
                : "No se pudo conectar con la API. ¿Está corriendo en localhost:3000?"}
            </AlertDescription>
          </Alert>
        )}

        {isLoading && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardContent className="p-6">
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...Array(3)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-28 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        {progreso && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={TrendingUp}
                iconClassName="text-primary"
                value={`${porcentajeAprobado}%`}
                label="Avance de carrera"
                sublabel={`${progreso.resumen.creditosAprobados}/${progreso.resumen.creditosTotalesCarrera} créditos`}
              />
              <StatCard
                icon={CheckCircle2}
                iconClassName="text-success"
                value={progreso.resumen.cursosAprobados}
                label="Cursos aprobados"
                sublabel={`de ${progreso.resumen.cursosTotales} totales`}
              />
              <StatCard
                icon={GraduationCap}
                iconClassName="text-estado-cursando"
                value={semestresCompletados}
                label="Semestres completados"
                sublabel={`de ${progreso.semestres.length} en la carrera`}
              />
              <StatCard
                icon={BookOpen}
                iconClassName="text-estado-sin-seccion"
                value={cursosMatriculados.length}
                label="Cursos este ciclo"
                sublabel={`${creditosCicloActual} créditos`}
              />
            </div>

            <Card>
              {/* flex, no solo flex-row: CardHeader trae "grid" en su
                  clase base (card.tsx) -- "grid" y "flex-row" son grupos
                  de conflicto DISTINTOS para Tailwind (display vs
                  flex-direction), así que "flex-row" solo nunca lo
                  reemplazaba. El resultado real era grid de una sola
                  columna implícita: título y "Ver malla" apilados en
                  filas separadas, no lado a lado como el nombre de la
                  clase sugiere -- bug preexistente, no algo que rompieran
                  los cambios de columnas de esta tarea. */}
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Avance en la malla</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {progreso.carrera.nombre}
                  </p>
                </div>
                {/* -my-3 py-3: agranda el área táctil real a ~44px de
                    alto sin empujar el layout visual (el padding extra
                    se compensa con el margen negativo) -- el texto solo
                    medía ~20px de alto antes, por debajo del mínimo
                    táctil cómodo. */}
                <Link
                  to="/malla"
                  className="-my-3 flex shrink-0 items-center gap-1 py-3 text-sm font-medium text-primary hover:underline"
                >
                  Ver malla <ChevronRight className="size-4" />
                </Link>
              </CardHeader>
              <CardContent>
                <Progress value={porcentajeAprobado} className="h-2.5" />
                <div className="flex justify-between text-sm mt-2.5">
                  <span className="text-muted-foreground">
                    {progreso.resumen.creditosAprobados} cr aprobados ·{" "}
                    {progreso.resumen.creditosTotalesCarrera -
                      progreso.resumen.creditosAprobados}{" "}
                    cr pendientes
                  </span>
                  <span className="font-medium">
                    {porcentajeAprobado}% completado
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cursos matriculados actualmente</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {cursosMatriculados.length} cursos · {creditosCicloActual} créditos
                </p>
              </CardHeader>
              <CardContent>
                {cursosMatriculados.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No hay cursos matriculados en el ciclo actual.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {cursosMatriculados.map((curso) => (
                      <CursoMatriculadoCard key={curso.idCurso} curso={curso} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </>
  )
}
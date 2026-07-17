import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Award, Ellipsis, Network } from "lucide-react"
import { resolverArea, codigoVisible } from "@/lib/curso-area"
import { Header } from "@/components/layout/Header"
import { EstadoBadge, ESTADOS_CURSO } from "@/components/shared/EstadoBadge"
import { useAuthStore } from "@/store/authStore"
import { useCarreraStore } from "@/store/carreraStore"
import { useMalla } from "@/hooks/useMalla"
import { usePrerequisiteHighlight } from "@/hooks/usePrerequisiteHighlight"
import { useLongPressTooltip } from "@/hooks/useLongPressTooltip"
import { estudianteService } from "@/services/estudiante.service"
import { ApiError } from "@/services/api"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PrerequisiteLinesOverlay } from "@/components/malla/PrerequisiteLinesOverlay"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CARRERAS } from "@/types/academico"
import type {
  CursoConProgreso,
  EstadoCursoProgreso,
} from "@/types/estudiante"
import type { MallaCurso } from "@/types/malla"




// -----------------------------------------------------------------------
// Card de curso dentro del accordion
// -----------------------------------------------------------------------

interface CursoCardProps {
  curso: CursoConProgreso
  onMarcarAprobado: (codigo: string) => void
  onDesmarcarAprobado: (codigo: string) => void
  onToggleHighlight: (codigo: string) => void
  registerCardRef: (codigo: string, el: HTMLElement | null) => void
  isHighlighted: boolean
  isDimmed: boolean
  highlightModeActive: boolean
  showMoreRequirementsIcon: boolean
  marcando: boolean
  desmarcando: boolean
}

function CursoCard({
  curso,
  onMarcarAprobado,
  onDesmarcarAprobado,
  onToggleHighlight,
  registerCardRef,
  isHighlighted,
  isDimmed,
  highlightModeActive,
  showMoreRequirementsIcon,
  marcando,
  desmarcando,
}: CursoCardProps) {
  const area = resolverArea(curso.codigo)
  // El switch alterna entre aprobado y pendiente/sin_seccion en ambas
  // direcciones. "cursando" queda fuera de alcance -- trae una sección
  // real matriculada, no algo que este control deba tocar.
  const puedeAlternarse = curso.estado !== "cursando"
  const cambioPendiente = marcando || desmarcando
  // Slot genérico OPT{n} dentro de su ciclo real (ej. "Cuarto Año - I
  // Ciclo"), distinto del catálogo "Optativos" (cicloId="Opt") que lista
  // las electivas concretas. No se sabe qué electiva cubre este slot, así
  // que no se le muestra un número de créditos que no corresponde a nada
  // específico -- el crédito real se ve (y se cuenta) en el catálogo.
  const esSlotGenericoOptativo = curso.esOptativo && curso.cicloId !== "Opt"
  const tooltip = useLongPressTooltip(isHighlighted)

  return (
    <Tooltip open={tooltip.open} onOpenChange={tooltip.onOpenChange}>
      <TooltipTrigger asChild>
        <Card
          ref={(el) => registerCardRef(curso.codigo, el)}
          role="button"
          tabIndex={0}
          onClick={() => {
            if (tooltip.shouldSuppressClick()) return
            onToggleHighlight(curso.codigo)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onToggleHighlight(curso.codigo)
            }
          }}
          onTouchStart={tooltip.onTouchStart}
          onTouchEnd={tooltip.onTouchEnd}
          onTouchCancel={tooltip.onTouchCancel}
          className={`cursor-pointer border-t-4 transition-[opacity,box-shadow] ${area.borderClassName} ${
            isHighlighted
              ? `${area.badgeClassName} border-x-2 border-b-2 border-current`
              : ""
          } ${isDimmed ? "opacity-40" : ""}`}
        >
          <CardContent className="p-3 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-xs font-mono">
                  {codigoVisible(curso.codigo)}
                </Badge>
                <Badge className={`text-xs border-transparent ${area.badgeClassName}`}>
                  {area.label}
                </Badge>
                {showMoreRequirementsIcon && (
                  <Ellipsis
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-label="Tiene más prerrequisitos detrás"
                  />
                )}
              </div>
              <EstadoBadge estado={curso.estado} />
            </div>

            <p className="text-sm font-semibold leading-tight">{curso.nombre}</p>

            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/60">
              {esSlotGenericoOptativo ? (
                <span className="italic">Créditos según la electiva que curses</span>
              ) : (
                <span>{curso.creditos} créditos</span>
              )}
              {curso.nota && (
                <span className="flex items-center gap-1 font-medium text-foreground">
                  <Award className="size-3.5" />
                  Nota: {curso.nota}
                </span>
              )}
            </div>

            {puedeAlternarse && (
              // stopPropagation: interactuar con el switch no debe además
              // togglear el resaltado de prerrequisitos (el click
              // bubblearía hasta el onClick de la Card de arriba).
              <label
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-between gap-2 pt-1 border-t border-border/60 text-xs cursor-pointer"
              >
                <span>
                  {marcando
                    ? "Guardando..."
                    : desmarcando
                      ? "Deshaciendo..."
                      : curso.estado === "aprobado"
                        ? "Aprobado"
                        : "Marcar como aprobado"}
                </span>
                {/* checked refleja el estado real del curso (no un estado
                    local propio): togglear llama a marcar o desmarcar
                    según corresponda, y la card se re-renderiza con el
                    estado que vuelve del servidor tras invalidar la
                    query. disabled también mientras el resaltado de
                    prerrequisitos está activo, en CUALQUIER tarjeta, para
                    evitar un miss-click sobre el switch al navegar el
                    grafo resaltado. */}
                <Switch
                  checked={curso.estado === "aprobado"}
                  disabled={cambioPendiente || highlightModeActive}
                  onCheckedChange={(checked) => {
                    if (checked) onMarcarAprobado(curso.codigo)
                    else onDesmarcarAprobado(curso.codigo)
                  }}
                  className="data-[state=checked]:bg-success"
                />
              </label>
            )}
          </CardContent>
        </Card>
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex items-center gap-1.5">
          <Network className="size-3.5" />
          Ver prerrequisitos
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

// -----------------------------------------------------------------------
// Card de curso para el plan de estudios plano (sin progreso) -- se usa
// cuando la carrera seleccionada no es la del estudiante logueado, así
// que no hay historial_curso del que sacar estado/nota. Ver decisión en
// la conversación: no se inventa un estado que la API no puede dar.
// -----------------------------------------------------------------------

interface CursoPlanCardProps {
  curso: MallaCurso
  onToggleHighlight: (codigo: string) => void
  registerCardRef: (codigo: string, el: HTMLElement | null) => void
  isHighlighted: boolean
  isDimmed: boolean
  showMoreRequirementsIcon: boolean
}

function CursoPlanCard({
  curso,
  onToggleHighlight,
  registerCardRef,
  isHighlighted,
  isDimmed,
  showMoreRequirementsIcon,
}: CursoPlanCardProps) {
  const area = resolverArea(curso.code)
  const tooltip = useLongPressTooltip(isHighlighted)

  return (
    <Tooltip open={tooltip.open} onOpenChange={tooltip.onOpenChange}>
      <TooltipTrigger asChild>
        <Card
          ref={(el) => registerCardRef(curso.code, el)}
          role="button"
          tabIndex={0}
          onClick={() => {
            if (tooltip.shouldSuppressClick()) return
            onToggleHighlight(curso.code)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onToggleHighlight(curso.code)
            }
          }}
          onTouchStart={tooltip.onTouchStart}
          onTouchEnd={tooltip.onTouchEnd}
          onTouchCancel={tooltip.onTouchCancel}
          className={`cursor-pointer border-t-4 transition-[opacity,box-shadow] ${area.borderClassName} ${
            isHighlighted
              ? `${area.badgeClassName} border-x-2 border-b-2 border-current`
              : ""
          } ${isDimmed ? "opacity-40" : ""}`}
        >
          <CardContent className="p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-xs font-mono">
                {codigoVisible(curso.code)}
              </Badge>
              <Badge className={`text-xs border-transparent ${area.badgeClassName}`}>
                {area.label}
              </Badge>
              {showMoreRequirementsIcon && (
                <Ellipsis
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label="Tiene más prerrequisitos detrás"
                />
              )}
            </div>

            <p className="text-sm font-semibold leading-tight">{curso.name}</p>

            <div className="text-xs text-muted-foreground pt-1 border-t border-border/60">
              {curso.credits} créditos
            </div>
          </CardContent>
        </Card>
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex items-center gap-1.5">
          <Network className="size-3.5" />
          Ver prerrequisitos
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

// -----------------------------------------------------------------------
// Selector de carrera -- estado en Zustand (useCarreraStore), reutilizable
// fuera de esta pantalla (Sprint 7).
// -----------------------------------------------------------------------

function SelectorCarrera() {
  const carreraSeleccionada = useCarreraStore((s) => s.carreraSeleccionada)
  const setCarreraSeleccionada = useCarreraStore((s) => s.setCarreraSeleccionada)

  return (
    <Select value={carreraSeleccionada} onValueChange={setCarreraSeleccionada}>
      <SelectTrigger className="w-[160px] sm:w-[240px]" aria-label="Seleccionar carrera">
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
  )
}

// -----------------------------------------------------------------------
// Leyenda de líneas de resaltado (prerrequisito/correquisito) -- misma
// muestra en ambas vistas (propia y plan de otra carrera), ya que el
// resaltado de prerrequisitos funciona en las dos.
// -----------------------------------------------------------------------

function LeyendaLineasResaltado() {
  return (
    <>
      <div className="flex items-center gap-2 py-1.5">
        <svg width="24" height="10" className="shrink-0" aria-hidden="true">
          <line x1="0" y1="5" x2="24" y2="5" strokeWidth={2} className="stroke-prereq-link" />
        </svg>
        <span className="text-sm text-muted-foreground">Prerrequisito</span>
      </div>
      <div className="flex items-center gap-2 py-1.5">
        <svg width="24" height="10" className="shrink-0" aria-hidden="true">
          <line
            x1="0"
            y1="5"
            x2="24"
            y2="5"
            strokeWidth={2}
            strokeDasharray="4 3"
            className="stroke-prereq-link"
          />
        </svg>
        <span className="text-sm text-muted-foreground">Correquisito</span>
      </div>
    </>
  )
}

// -----------------------------------------------------------------------
// Conteo de estados para la card de leyenda
// -----------------------------------------------------------------------

function contarPorEstado(cursos: CursoConProgreso[]) {
  const conteo: Record<EstadoCursoProgreso, number> = {
    aprobado: 0,
    cursando: 0,
    pendiente: 0,
    sin_seccion: 0,
  }
  for (const curso of cursos) conteo[curso.estado]++
  return conteo
}

// -----------------------------------------------------------------------
// MallaPage
// -----------------------------------------------------------------------

export function MallaPage() {
  const estudiante = useAuthStore((s) => s.estudiante)
  const carreraSeleccionada = useCarreraStore((s) => s.carreraSeleccionada)

  // Resaltado in-place de prerrequisitos: qué tarjeta está activa, cuáles
  // son sus prerrequisitos directos y las líneas que las conectan.
  // Disponible en cualquier carrera, no depende del historial del
  // estudiante logueado.
  const prereqHighlight = usePrerequisiteHighlight()

  // La malla con progreso (estado/nota/sección) solo existe para la
  // carrera real del estudiante logueado -- viene de su historial_curso.
  // Si elige otra carrera desde el selector, se muestra el plan de
  // estudios plano (sin estado) vía GET /api/mallas/{carrera}.
  const esCarreraPropia = estudiante?.carrera.sigla === carreraSeleccionada

  const {
    data: progreso,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["malla-progreso", estudiante?.carnet],
    queryFn: () => estudianteService.obtenerMallaProgreso(estudiante!.carnet),
    enabled: !!estudiante && esCarreraPropia,
  })

  const {
    data: malla,
    isLoading: isLoadingMalla,
    error: errorMalla,
  } = useMalla(carreraSeleccionada, !esCarreraPropia)

  const queryClient = useQueryClient()

  // Invalidan en vez de actualizar el cache a mano -- sin_seccion y el %
  // de avance dependen de una regla que resuelve el backend, no hay forma
  // segura de recalcularlos en el cliente.
  const invalidarProgreso = () =>
    queryClient.invalidateQueries({ queryKey: ["malla-progreso", estudiante?.carnet] })

  const marcarAprobadoMutation = useMutation({
    mutationFn: (codigoCurso: string) =>
      estudianteService.marcarAprobado(estudiante!.carnet, codigoCurso),
    onSuccess: invalidarProgreso,
  })

  const desmarcarAprobadoMutation = useMutation({
    mutationFn: (codigoCurso: string) =>
      estudianteService.desmarcarAprobado(estudiante!.carnet, codigoCurso),
    onSuccess: invalidarProgreso,
  })

  // El switch es reversible: ya no hace falta confirmar con un diálogo,
  // togglear de nuevo deshace la acción.
  function handleMarcarAprobado(codigo: string) {
    marcarAprobadoMutation.mutate(codigo)
  }

  function handleDesmarcarAprobado(codigo: string) {
    desmarcarAprobadoMutation.mutate(codigo)
  }

  const todosLosCursos = progreso?.semestres.flatMap((s) => s.cursos) ?? []
  const conteo = contarPorEstado(todosLosCursos)
  const creditosPendientes = progreso
    ? progreso.resumen.creditosTotalesCarrera - progreso.resumen.creditosAprobados
    : 0
  const porcentaje = progreso
    ? Math.round(
        (progreso.resumen.creditosAprobados /
          progreso.resumen.creditosTotalesCarrera) *
          100
      )
    : 0

  // Todos los semestres abiertos por defecto, según lo acordado.
  const todosLosCiclos = progreso?.semestres.map((s) => s.cicloId) ?? []

  return (
    <>
      <Header
        title="Malla Curricular"
        description={
          esCarreraPropia && estudiante
            ? `${estudiante.carrera.nombre} · ${estudiante.cicloActualId || "sin ciclo asignado"}`
            : malla?.programName
        }
        actions={<SelectorCarrera />}
      />
      <main
        ref={prereqHighlight.containerRef}
        className="relative flex-1 p-4 md:p-6 space-y-4"
      >
        {!esCarreraPropia && malla && (
          <Card className="max-w-xs">
            <CardHeader>
              <CardTitle className="text-sm">Conexiones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              <LeyendaLineasResaltado />
            </CardContent>
          </Card>
        )}

        {!esCarreraPropia && (
          <Alert>
            <AlertDescription>
              Viendo el plan de estudios de {malla?.programName ?? "esta carrera"}.
              No es tu progreso -- para ver tu avance real volvé a{" "}
              {estudiante?.carrera.nombre}.
            </AlertDescription>
          </Alert>
        )}

        {esCarreraPropia && marcarAprobadoMutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {marcarAprobadoMutation.error instanceof ApiError
                ? marcarAprobadoMutation.error.message
                : "No se pudo guardar el curso como aprobado. Intenta de nuevo."}
            </AlertDescription>
          </Alert>
        )}

        {esCarreraPropia && desmarcarAprobadoMutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {desmarcarAprobadoMutation.error instanceof ApiError
                ? desmarcarAprobadoMutation.error.message
                : "No se pudo deshacer el curso aprobado. Intenta de nuevo."}
            </AlertDescription>
          </Alert>
        )}

        {esCarreraPropia && error && (
          <Alert variant="destructive">
            <AlertDescription>
              {import.meta.env.DEV
                ? error instanceof ApiError
                  ? `${error.status}: ${error.message}`
                  : "No se pudo conectar con la API. ¿Está corriendo en localhost:3000?"
                : "No pudimos cargar tu avance. Intenta de nuevo más tarde."}
            </AlertDescription>
          </Alert>
        )}

        {!esCarreraPropia && errorMalla && (
          <Alert variant="destructive">
            <AlertDescription>
              {import.meta.env.DEV
                ? errorMalla instanceof ApiError
                  ? `${errorMalla.status}: ${errorMalla.message}`
                  : "No se pudo conectar con la API. ¿Está corriendo en localhost:3000?"
                : "No pudimos cargar el plan de estudios. Intenta de nuevo más tarde."}
            </AlertDescription>
          </Alert>
        )}

        {!esCarreraPropia && isLoadingMalla && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card px-4 py-4"
              >
                <Skeleton className="h-5 w-1/3" />
              </div>
            ))}
          </div>
        )}

        {!esCarreraPropia && malla && (
          <Accordion
            type="multiple"
            defaultValue={malla.cycles.map((c) => c.cycleId)}
            className="w-full space-y-3"
          >
            {malla.cycles.map((ciclo) => {
              const creditosCiclo = ciclo.courses.reduce(
                (sum, c) => sum + Number(c.credits),
                0
              )
              return (
                <AccordionItem
                  key={ciclo.cycleId}
                  value={ciclo.cycleId}
                  className="rounded-lg border border-border bg-card px-4"
                >
                  {/* relative z-20 bg-card: sin esto, al ser position:static
                      queda SIEMPRE detrás del <svg> del resaltado de
                      prerrequisitos (z-10), sin importar el z-index -- un
                      elemento no posicionado nunca gana contra uno
                      posicionado. bg-card propio (no solo heredado del
                      AccordionItem) para tapar la línea que pasa detrás. */}
                  <AccordionTrigger className="relative z-20 bg-card">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{ciclo.cycleName}</span>
                      <span className="text-xs text-muted-foreground font-normal">
                        {ciclo.courses.length} cursos · {creditosCiclo} créditos
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-2">
                      {ciclo.courses.map((curso) => (
                        <CursoPlanCard
                          key={curso.code}
                          curso={curso}
                          onToggleHighlight={prereqHighlight.toggleCourse}
                          registerCardRef={prereqHighlight.registerCardRef}
                          isHighlighted={prereqHighlight.isHighlighted(curso.code)}
                          isDimmed={prereqHighlight.isDimmed(curso.code)}
                          showMoreRequirementsIcon={prereqHighlight.hasMoreRequirements(
                            curso.code
                          )}
                        />
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        )}

        {esCarreraPropia && isLoading && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...Array(2)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <Skeleton className="h-24 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-card px-4 py-4"
                >
                  <Skeleton className="h-5 w-1/3" />
                </div>
              ))}
            </div>
          </>
        )}

        {esCarreraPropia && progreso && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Avance global */}
              <Card>
                <CardHeader>
                  <CardTitle>Avance en la malla</CardTitle>
                  <CardDescription>{progreso.carrera.nombre}</CardDescription>
                  <p className="text-xs italic text-muted-foreground">
                    Basado en tu historial registrado, no sincronizado con el
                    sistema oficial
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold tracking-tight">
                      {porcentaje}%
                    </span>
                    <span className="text-sm text-muted-foreground">
                      completado
                    </span>
                  </div>
                  <Progress value={porcentaje} className="h-2.5" />
                  <div className="grid grid-cols-3 gap-2 pt-2 text-sm">
                    <div>
                      <p className="font-semibold">
                        {progreso.resumen.creditosAprobados}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        créditos aprobados
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold">{creditosPendientes}</p>
                      <p className="text-xs text-muted-foreground">
                        créditos pendientes
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold">
                        {progreso.resumen.cursosAprobados}/
                        {progreso.resumen.cursosTotales}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        cursos completados
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Leyenda de estados */}
              <Card>
                <CardHeader>
                  <CardTitle>Estado de cursos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {ESTADOS_CURSO.map((estado) => (
                    <div
                      key={estado}
                      className="flex items-center justify-between py-1.5"
                    >
                      <EstadoBadge estado={estado} />
                      <span className="text-sm text-muted-foreground font-mono">
                        {conteo[estado]}
                      </span>
                    </div>
                  ))}

                  {/* Qué significa cada línea al resaltar prerrequisitos --
                      mismo patrón de fila que los estados de arriba
                      (icono/muestra a la izquierda, texto a la derecha)
                      para que se vea como una extensión de la leyenda, no
                      como una sección aparte. */}
                  <div className="border-t border-border/60 pt-2 mt-1 space-y-1">
                    <LeyendaLineasResaltado />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Plan de estudios por semestre -- todos abiertos por defecto */}
            <Accordion
              type="multiple"
              defaultValue={todosLosCiclos}
              className="w-full space-y-3"
            >
              {progreso.semestres.map((semestre) => {
                const creditosSemestre = semestre.cursos.reduce(
                  (sum, c) => sum + Number(c.creditos),
                  0
                )
                return (
                  <AccordionItem
                    key={semestre.cicloId}
                    value={semestre.cicloId}
                    className="rounded-lg border border-border bg-card px-4"
                  >
                    {/* relative z-20 bg-card: sin esto, al ser position:static
                      queda SIEMPRE detrás del <svg> del resaltado de
                      prerrequisitos (z-10), sin importar el z-index -- un
                      elemento no posicionado nunca gana contra uno
                      posicionado. bg-card propio (no solo heredado del
                      AccordionItem) para tapar la línea que pasa detrás. */}
                  <AccordionTrigger className="relative z-20 bg-card">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">
                          {semestre.cicloNombre}
                        </span>
                        {semestre.cicloId === progreso.estudiante.cicloActualId && (
                          <Badge variant="outline" className="text-xs">
                            Ciclo actual
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground font-normal">
                          {semestre.cursos.length} cursos · {creditosSemestre} créditos
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-2">
                        {semestre.cursos.map((curso) => (
                          <CursoCard
                            key={curso.idCurso}
                            curso={curso}
                            onMarcarAprobado={handleMarcarAprobado}
                            onDesmarcarAprobado={handleDesmarcarAprobado}
                            onToggleHighlight={prereqHighlight.toggleCourse}
                            registerCardRef={prereqHighlight.registerCardRef}
                            isHighlighted={prereqHighlight.isHighlighted(curso.codigo)}
                            isDimmed={prereqHighlight.isDimmed(curso.codigo)}
                            highlightModeActive={!!prereqHighlight.activeCourseCode}
                            showMoreRequirementsIcon={prereqHighlight.hasMoreRequirements(
                              curso.codigo
                            )}
                            marcando={
                              marcarAprobadoMutation.isPending &&
                              marcarAprobadoMutation.variables === curso.codigo
                            }
                            desmarcando={
                              desmarcarAprobadoMutation.isPending &&
                              desmarcarAprobadoMutation.variables === curso.codigo
                            }
                          />
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          </>
        )}

        <PrerequisiteLinesOverlay
          active={!!prereqHighlight.activeCourseCode}
          lines={prereqHighlight.lines}
        />
      </main>
    </>
  )
}
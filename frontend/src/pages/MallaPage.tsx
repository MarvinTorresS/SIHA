import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  Award,
  Ellipsis,
  Loader2,
  Network,
  Pencil,
  SquareCheckBig,
  Undo2,
  X,
} from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PrerequisiteLinesOverlay } from "@/components/malla/PrerequisiteLinesOverlay"
import { AsignarCursoRealSheet } from "@/components/malla/AsignarCursoRealSheet"
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
  onToggleAprobado: (codigo: string, actualmenteAprobado: boolean) => void
  onOpenSlotSheet: (codigo: string) => void
  onDesasignarSlot: (codigo: string) => void
  onToggleHighlight: (codigo: string) => void
  registerCardRef: (codigo: string, el: HTMLElement | null) => void
  isHighlighted: boolean
  isDimmed: boolean
  highlightModeActive: boolean
  editModeActive: boolean
  showMoreRequirementsIcon: boolean
  marcando: boolean
  desmarcando: boolean
  desasignando: boolean
}

function CursoCard({
  curso,
  onToggleAprobado,
  onOpenSlotSheet,
  onDesasignarSlot,
  onToggleHighlight,
  registerCardRef,
  isHighlighted,
  isDimmed,
  highlightModeActive,
  editModeActive,
  showMoreRequirementsIcon,
  marcando,
  desmarcando,
  desasignando,
}: CursoCardProps) {
  const area = resolverArea(curso.codigo)
  const cambioPendiente = marcando || desmarcando || desasignando
  const aprobado = curso.estado === "aprobado"
  // Slot genérico OPT{n} dentro de su ciclo real (ej. "Cuarto Año - I
  // Ciclo"), distinto del catálogo "Optativos" (cicloId="Opt") que lista
  // las electivas concretas. No se sabe qué electiva cubre este slot, así
  // que no se le muestra un número de créditos que no corresponde a nada
  // específico -- el crédito real se ve (y se cuenta) en el catálogo.
  const esSlotGenericoOptativo = curso.esOptativo && curso.cicloId !== "Opt"
  // Catálogo "Estudios Generales" (cicloId="General"): lista TODOS los
  // cursos reales de generales (EGA121, EGS118, EGF/EGC/...), no solo
  // los 4 que la carrera exige -- ver getMallaProgreso en el backend.
  // Marcar uno acá como aprobado no suma directo a creditosAprobados/
  // cursosTotales (el backend excluye cicloId="General" a propósito,
  // igual que hace con "Opt"): el crédito se refleja recién cuando el
  // autocompletado empareja este curso con uno de los 4 slots GEN{n}
  // reales de la carrera (ver resolverCursoGeneralParaSlot). Mismo
  // patrón que el mensaje de Optativos, pero en el sentido inverso:
  // ahí el mensaje va en el slot genérico (no se sabe qué electiva lo
  // cubre); acá va en el catálogo (no se sabe a cuál de los 4 slots
  // termina emparejado, ni si ya hay uno emparejado con otro curso).
  const esCursoGeneralEnCatalogo = curso.cicloId === "General"
  // Slot de malla con selector de curso real (GEN{n}/OPT{n}): en vez de
  // togglear directo, el check/card abre el Sheet de "¿cuál curso
  // aprobaste?" -- ver AsignarCursoRealSheet. GEN se detecta por patrón
  // de código (no tiene esOptativo=true); OPT ya tiene esSlotGenericoOptativo.
  const esSlotConSelector = /^GEN\d+_/.test(curso.codigo) || esSlotGenericoOptativo
  // Un slot con selector ya "resuelto" no debe reabrir el Sheet al hacer
  // click -- cubre dos formas de estar resuelto: (a) curso real vinculado
  // vía id_slot_malla (cursoRealCodigo no nulo, ver getMallaProgreso) o
  // (b) caso legacy pre-Sheet, donde el propio placeholder GEN{n}/OPT{n}
  // quedó marcado aprobado/cursando directo, sin curso real distinguido
  // (cursoRealCodigo null pero estado ya resuelto). Sin esto, un slot ya
  // aprobado por cualquiera de las dos vías reabre el selector en vez de
  // comportarse como el checkbox normal de cualquier otra card -- el bug
  // real reportado (no se podía desmarcar Generales ya aprobados).
  const slotYaResuelto =
    esSlotConSelector && (curso.cursoRealCodigo !== null || aprobado || curso.estado === "cursando")
  const tooltip = useLongPressTooltip(isHighlighted)

  // Único punto de decisión entre abrir el Sheet, desasignar un slot con
  // curso real vinculado, o togglear como cualquier card normal -- ver
  // tabla de casos en slotYaResuelto/cursoRealCodigo arriba. Compartido
  // por el check de la esquina y el click de card completa en modo edición
  // para no duplicar la misma rama tres veces.
  function handleToggleOApertura() {
    if (esSlotConSelector && !slotYaResuelto) {
      onOpenSlotSheet(curso.codigo)
      return
    }
    if (esSlotConSelector && curso.cursoRealCodigo !== null) {
      // desmarcarAprobado (DELETE /historial/:codigoCurso) busca la fila
      // por id_curso = codigo enviado, que acá sería el placeholder -- la
      // fila real vive con id_curso del curso real, vinculada por
      // id_slot_malla, así que esa ruta no la encontraría (no-op
      // silencioso). desasignarSlotMalla sí resuelve por id_slot_malla.
      onDesasignarSlot(curso.codigo)
      return
    }
    onToggleAprobado(curso.codigo, aprobado)
  }

  function handleCheckClick(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
    if (cambioPendiente || highlightModeActive) return
    handleToggleOApertura()
  }

  // Fuera del modo edición, un click en la card resalta prerrequisitos
  // (patrón de siempre) y el check chico de la esquina es el único
  // target para marcar aprobado. Dentro del modo edición, TODA la card
  // pasa a ser el target de "marcar aprobado" -- el resaltado queda
  // desactivado mientras el modo está activo (ver handleEntrarModoEdicion
  // en MallaPage, que cierra cualquier resaltado abierto al entrar).
  function handleCardClick() {
    if (tooltip.shouldSuppressClick()) return
    if (editModeActive) {
      if (cambioPendiente) return
      handleToggleOApertura()
    } else {
      onToggleHighlight(curso.codigo)
    }
  }

  return (
    <Tooltip open={!editModeActive && tooltip.open} onOpenChange={tooltip.onOpenChange}>
      <TooltipTrigger asChild>
        <Card
          ref={(el) => registerCardRef(curso.codigo, el)}
          role="button"
          tabIndex={0}
          aria-pressed={editModeActive ? aprobado : undefined}
          onClick={handleCardClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              handleCardClick()
            }
          }}
          onTouchStart={tooltip.onTouchStart}
          onTouchEnd={tooltip.onTouchEnd}
          onTouchCancel={tooltip.onTouchCancel}
          className={`cursor-pointer border-t-4 transition-[opacity,box-shadow] ${area.borderClassName} ${
            isHighlighted
              ? `${area.badgeClassName} border-x-2 border-b-2 border-current`
              : ""
          } ${isDimmed ? "opacity-40" : ""} ${
            editModeActive
              ? // border real en los otros 3 lados (mismo patrón que
                // isHighlighted arriba), no ring/outline: un ring dejaba
                // un hueco en la esquina (border-t-4 de 4px vs border de
                // 1px en los otros lados -- radios de curva distintos,
                // ver Fix 3), y un outline con offset introducía un
                // desfase de curvatura propio (offset > 0 no tiene forma
                // de declarar el border-radius que necesitaría para ser
                // concéntrico). border-x-4/border-b-4 iguala el grosor
                // en los 4 lados (elimina el desbalance) y dejando
                // border-t-4 intacto el color de área sigue siendo el
                // protagonista arriba -- el gris de modo edición queda
                // como indicador secundario en los otros 3 lados, no
                // compitiendo por el mismo espacio.
                "border-x-4 border-b-4 border-edit-mode-ring/40 hover:border-edit-mode-ring/70"
              : ""
          }`}
        >
          <CardContent className="p-3 space-y-1.5">
            {/* flex-wrap en la fila + min-w-0 en el grupo izquierdo: sin
                min-w-0, ese div (check+código+badge de área+ellipsis) no
                tiene piso de achique explícito -- con el badge de área
                "Estudios generales" (el label más largo, visible desde
                sm) eso puede seguir siendo más ancho que la card en
                anchos intermedios, y sin flex-wrap en la fila exterior
                el badge de estado (shrink-0 por Badge base) no tiene a
                dónde caer -- queda empujado fuera del borde derecho en
                vez de bajar a una línea nueva. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1 flex-wrap">
                {/* Check circular persistente: siempre visible, con halo
                    táctil de 44px (mínimo real recomendado) aunque el
                    círculo se vea más chico -- es el único target de
                    "marcar aprobado" fuera del modo edición. Antes esto
                    vivía en una fila al pie de la card compartiendo
                    espacio visual con el resaltado de prerrequisitos
                    (toda la card), lo que producía missclicks constantes
                    entre ambas acciones.
                    -m-1.5: el margen (no el tamaño de la caja) es lo que
                    determina qué tan cerca queda del borde de la card --
                    con -m-2.5 el halo quedaba a ~3px del borde, la misma
                    banda angosta donde pinta el ring-2/border del modo
                    edición, y se veía "cortado". -m-1.5 lo aleja lo
                    suficiente sin importar el tamaño de la caja (subirla
                    a 44px no reintroduce ese choque, solo extiende el
                    lado derecho hacia el resto de la fila). */}
                <button
                  type="button"
                  onClick={handleCheckClick}
                  disabled={cambioPendiente || highlightModeActive}
                  aria-label={
                    aprobado
                      ? `Desmarcar ${curso.nombre} como aprobado`
                      : `Marcar ${curso.nombre} como aprobado`
                  }
                  className="-m-1.5 grid size-11 shrink-0 place-content-center rounded-full disabled:cursor-not-allowed"
                >
                  {cambioPendiente ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Checkbox
                      checked={aprobado}
                      disabled={highlightModeActive}
                      tabIndex={-1}
                      className="pointer-events-none size-5 rounded-full border-2 data-[state=checked]:border-success data-[state=checked]:bg-success"
                    />
                  )}
                </button>
                <Badge variant="outline" className="text-xs font-mono">
                  {curso.cursoRealCodigo ?? codigoVisible(curso.codigo)}
                </Badge>
                {/* Texto del badge de área oculto <sm (2 columnas, ~150px
                    por card -- no entra junto al nombre del curso sin
                    truncarlo). El borde superior de 4px (área.borderClassName,
                    ya aplicado en la Card) sigue siendo el indicador de
                    área ahí; se compensa con la leyenda de colores que
                    aparece una sola vez por pantalla, también <sm -- ver
                    LeyendaAreas más abajo. Desde sm (tablet, 2 columnas
                    con más ancho) el badge vuelve con su texto normal. */}
                <Badge
                  className={`hidden text-xs border-transparent sm:inline-flex ${area.badgeClassName}`}
                >
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

            <p className="text-sm font-semibold leading-tight pl-1">{curso.nombre}</p>
            {curso.cursoRealCodigo && (
              <p className="text-xs text-muted-foreground leading-tight pl-1">
                {curso.cursoRealNombre}
              </p>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/60 pl-1">
              {esSlotConSelector && !slotYaResuelto ? (
                <span>Marcá el check para elegir cuál curso aprobaste</span>
              ) : esCursoGeneralEnCatalogo ? (
                <span className="italic">
                  {curso.creditos} créditos -- se reflejan en el slot de Estudios
                  Generales de tu ciclo real
                </span>
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
              {/* Mismo criterio que CursoCard (progreso propio) más
                  arriba: texto oculto <sm, el borde superior de 4px +
                  la leyenda compensan. */}
              <Badge
                className={`hidden text-xs border-transparent sm:inline-flex ${area.badgeClassName}`}
              >
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
// Leyenda de colores por área -- compensa que <sm el badge de área pierde
// su texto en cada card de curso (no entra junto al nombre en el ancho
// de 2 columnas de mobile, ~150px por card). Se muestra una sola vez por
// pantalla, no repetida en cada card -- solo <sm, porque desde sm el
// badge ya vuelve a traer su propio texto (ver CursoCard/CursoPlanCard).
// -----------------------------------------------------------------------

function LeyendaAreas({ codigos }: { codigos: string[] }) {
  // Dedup por label -- varios códigos pueden mapear a la misma área
  // (ej. EGF/EGC/EGS/EGA -> "Estudios generales"). dotClassName es un
  // literal de curso-area.ts (mismo tono que el borde superior de la
  // card) -- no se arma con un .replace() en runtime porque Tailwind
  // resuelve clases por escaneo estático del código fuente: un string
  // "bg-area-x" construido en runtime nunca aparece tal cual en ningún
  // archivo, así que JIT no genera esa regla CSS y el punto sale sin
  // color (bug real de la primera versión de este componente).
  const areas = new Map<string, string>()
  for (const codigo of codigos) {
    const area = resolverArea(codigo)
    if (!areas.has(area.label)) {
      areas.set(area.label, area.dotClassName)
    }
  }
  if (areas.size === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2 sm:hidden">
      <span className="text-xs font-medium text-muted-foreground">Área:</span>
      {Array.from(areas).map(([label, dotClassName]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={`size-2.5 shrink-0 rounded-full ${dotClassName}`} aria-hidden="true" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </span>
      ))}
    </div>
  )
}

// -----------------------------------------------------------------------
// Conteo de estados para la card de leyenda
// -----------------------------------------------------------------------

// El catálogo "Estudios Generales" (cicloId="General") lista TODOS los
// cursos reales de generales que existen (EGA121, EGS118, EGF/EGC/...),
// no solo los que la carrera exige -- la carrera solo tiene 4 slots
// GEN{n}_{sigla} reales, uno por ciclo, que la API autocompleta con el
// estado del curso real que corresponda (ver getMallaProgreso en el
// backend). Contar el catálogo ADEMÁS de los 4 slots duplica la misma
// matrícula tantas veces como cursos de generales haya en el catálogo --
// por eso el backend ya excluye cicloId="General" por completo de
// resumen.cursosTotales/cursosAprobados (mismo trato que "Opt", el
// catálogo de electivas). Este conteo replica ese mismo criterio: solo
// se cuentan los 4 slots reales (viven en su ciclo real, no en
// "General"), el catálogo se sigue mostrando en la grilla (no se toca
// esa parte) pero queda afuera de la tarjeta "Estado de cursos".
function contarPorEstado(cursos: CursoConProgreso[]) {
  const conteo: Record<EstadoCursoProgreso, number> = {
    aprobado: 0,
    cursando: 0,
    pendiente: 0,
    sin_seccion: 0,
  }
  for (const curso of cursos) {
    if (curso.cicloId === "General") continue
    conteo[curso.estado]++
  }
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
  // estudiante logueado -- pero sí se acota a carreraSeleccionada, porque
  // un curso compartido entre carreras (ej. MAT002) puede tener
  // prerrequisitos distintos según la carrera.
  const prereqHighlight = usePrerequisiteHighlight(carreraSeleccionada)

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

  // Desmarcar un slot GEN{n}/OPT{n} que ya tiene un curso real vinculado vía
  // id_slot_malla -- distinto de desmarcarAprobadoMutation porque esa pega
  // en DELETE /historial/:codigoCurso, que busca la fila por id_curso =
  // el placeholder mismo. En este caso la fila real vive con id_curso del
  // curso real, no del placeholder -- esa búsqueda no encuentra nada y
  // queda en no-op silencioso. desasignarSlotMalla sí resuelve por
  // id_slot_malla (ver estudiante.service.ts backend).
  const desasignarSlotMutation = useMutation({
    mutationFn: (slotCodigo: string) =>
      estudianteService.desasignarSlotMalla(estudiante!.carnet, slotCodigo),
    onSuccess: invalidarProgreso,
  })

  // Sheet de "¿cuál curso aprobaste?" para slots GEN{n}/OPT{n} -- null = cerrado.
  const [slotAbierto, setSlotAbierto] = useState<string | null>(null)

  // -----------------------------------------------------------------------
  // Modo edición por lotes: pensado para marcar varios cursos aprobados
  // seguidos (ej. al empezar semestre) sin que cada click en la card
  // dispare el resaltado de prerrequisitos en su lugar. Cada toggle sigue
  // llamando al backend de inmediato (no hay "guardar" al salir) -- "Listo"
  // solo cierra el modo, así que cerrar la pestaña a mitad no pierde
  // cambios. originalStatesRef espeja el estado (además del useState, que
  // solo existe para re-renderizar el banner) para que los listeners de
  // Esc/click-afuera -- suscritos una sola vez al entrar al modo -- lean
  // siempre el valor más reciente en vez de quedarse con el closure de
  // cuando se suscribieron.
  const [editMode, setEditMode] = useState(false)
  const [originalStates, setOriginalStatesState] = useState<Map<string, boolean>>(
    new Map()
  )
  const originalStatesRef = useRef(originalStates)

  function setOriginalStates(
    updater: (prev: Map<string, boolean>) => Map<string, boolean>
  ) {
    setOriginalStatesState((prev) => {
      const next = updater(prev)
      originalStatesRef.current = next
      return next
    })
  }

  function handleEntrarModoEdicion() {
    prereqHighlight.closeHighlight()
    setEditMode(true)
    setOriginalStates(() => new Map())
  }

  function handleSalirModoEdicion() {
    const total = originalStatesRef.current.size
    setEditMode(false)
    setOriginalStates(() => new Map())
    if (total > 0) {
      toast.success(
        `Guardado · ${total} ${total === 1 ? "curso actualizado" : "cursos actualizados"}`
      )
    }
  }

  // Deshace únicamente los toggles hechos durante esta sesión del modo
  // edición, restaurando cada curso a como estaba al tocarlo por primera
  // vez -- no un historial completo, una sola acción de undo. marcar/
  // desmarcar son idempotentes (upsert / deleteMany), así que no hace
  // falta chequear el estado actual antes de restaurar.
  function handleDeshacer() {
    for (const [codigo, eraAprobado] of originalStatesRef.current) {
      if (eraAprobado) marcarAprobadoMutation.mutate(codigo)
      else desmarcarAprobadoMutation.mutate(codigo)
    }
    setOriginalStates(() => new Map())
  }

  // Usado tanto por el check persistente de cada card (disponible siempre)
  // como por el click en toda la card cuando el modo edición está activo.
  function handleToggleAprobado(codigo: string, actualmenteAprobado: boolean) {
    if (editMode) {
      setOriginalStates((prev) => {
        if (prev.has(codigo)) return prev
        const next = new Map(prev)
        next.set(codigo, actualmenteAprobado)
        return next
      })
    }
    if (actualmenteAprobado) desmarcarAprobadoMutation.mutate(codigo)
    else marcarAprobadoMutation.mutate(codigo)
  }

  // Esc para salir del modo -- se re-suscribe solo cuando editMode o
  // slotAbierto cambian (handleSalirModoEdicion lee el ref, no un closure
  // capturado acá, así que sigue viendo el valor correcto igual). Con el
  // Sheet de "¿cuál curso aprobaste?" abierto, Esc solo debe cerrar el
  // Sheet (lo maneja Radix) -- si además sale del modo edición, se pierde
  // el contexto de qué se estaba marcando.
  useEffect(() => {
    if (!editMode) return
    function onKeyDown(e: KeyboardEvent) {
      if (slotAbierto !== null) return
      if (e.key === "Escape") handleSalirModoEdicion()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, slotAbierto])

  // Click fuera de la grilla (en el chrome de la app: sidebar, header)
  // también sale del modo -- prereqHighlight.containerRef ya apunta al
  // <main> que envuelve toda la malla. El Sheet de "¿cuál curso
  // aprobaste?" (AsignarCursoRealSheet) se monta vía Radix Portal, FUERA
  // de <main> -- sin el chequeo de slotAbierto, elegir una opción o tocar
  // "Confirmar" ahí adentro se leía como "click afuera de la grilla" y
  // cerraba el modo edición a mitad de la selección (el bug real
  // reportado: al marcar una Estudios Generales, se salía del modo).
  useEffect(() => {
    if (!editMode) return
    function onMouseDown(e: MouseEvent) {
      if (slotAbierto !== null) return
      const container = prereqHighlight.containerRef.current
      if (container && !container.contains(e.target as Node)) {
        handleSalirModoEdicion()
      }
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, slotAbierto])

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
          esCarreraPropia && estudiante ? estudiante.carrera.nombre : malla?.programName
        }
        actions={
          <>
            {esCarreraPropia && progreso && !editMode && (
              <Button variant="outline" size="sm" onClick={handleEntrarModoEdicion}>
                <Pencil />
                {/* Nunca solo el ícono -- ambiguo, no queda claro qué
                    activa. Label corto siempre visible; en sm+ se
                    reemplaza por el texto completo (hay espacio de
                    sobra ahí, no compite con el título por una fila). */}
                <span className="sm:hidden">Marcar aprobados</span>
                <span className="hidden sm:inline">Marcar cursos aprobados</span>
              </Button>
            )}
            <SelectorCarrera />
          </>
        }
      />
      <main
        ref={prereqHighlight.containerRef}
        className="relative flex-1 p-4 md:p-6 space-y-4"
      >
        {/* Banner del modo edición: sticky en vez de modal -- no bloquea
            el scroll ni la vista de la malla mientras se marca en lote.
            El acento de color (bg-primary/10 + ring) es intencionalmente
            distinto al resto del chrome para que sea inequívoco en qué
            modo se está. */}
        {editMode && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-medium">
              <SquareCheckBig className="size-4 text-primary" />
              Editando tus aprobaciones
              {originalStates.size > 0 && (
                <span className="font-normal text-muted-foreground">
                  · {originalStates.size}{" "}
                  {originalStates.size === 1 ? "curso marcado" : "cursos marcados"} en
                  esta sesión
                </span>
              )}
              <span className="hidden text-xs font-normal text-muted-foreground md:inline">
                (Esc para salir)
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeshacer}
                disabled={originalStates.size === 0}
              >
                <Undo2 />
                Deshacer
              </Button>
              <Button size="sm" onClick={handleSalirModoEdicion}>
                <X />
                Listo
              </Button>
            </span>
          </div>
        )}

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

        {esCarreraPropia && desasignarSlotMutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {desasignarSlotMutation.error instanceof ApiError
                ? desasignarSlotMutation.error.message
                : "No se pudo desasignar el curso del slot. Intenta de nuevo."}
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
          <LeyendaAreas codigos={malla.cycles.flatMap((c) => c.courses.map((co) => co.code))} />
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
                    {/* min-w-0 + flex-1 en el título (no flex-wrap en el
                        contenedor): el título es el único elemento que
                        puede angostarse -- si no entra, se trunca con
                        ellipsis. El subtítulo es shrink-0, nunca cede su
                        espacio, así que nunca cae a una segunda línea.
                        Antes, con flex-wrap y sin min-width en nada, un
                        título más largo empujaba el wrap del subtítulo
                        mientras títulos cortos no lo hacían -- misma
                        fila, alto distinto entre ciclos sin motivo real. */}
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate font-semibold">{ciclo.cycleName}</span>
                      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground font-normal">
                        {ciclo.courses.length} cursos · {creditosCiclo} créditos
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pb-2">
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

            <LeyendaAreas codigos={todosLosCursos.map((c) => c.codigo)} />

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
                      {/* min-w-0 + flex-1 en el título, badge y subtítulo
                          shrink-0 -- ver comentario igual en el otro
                          AccordionTrigger de esta pantalla (plan plano de
                          otra carrera). Mismo bug, misma fix: el título es
                          lo único que se trunca si no entra, el resto
                          nunca cae a una segunda línea. */}
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate font-semibold">
                          {semestre.cicloNombre}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground font-normal">
                          {semestre.cursos.length} cursos · {creditosSemestre} créditos
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pb-2">
                        {semestre.cursos.map((curso) => (
                          <CursoCard
                            key={curso.idCurso}
                            curso={curso}
                            onToggleAprobado={handleToggleAprobado}
                            onOpenSlotSheet={setSlotAbierto}
                            onDesasignarSlot={desasignarSlotMutation.mutate}
                            onToggleHighlight={prereqHighlight.toggleCourse}
                            registerCardRef={prereqHighlight.registerCardRef}
                            isHighlighted={prereqHighlight.isHighlighted(curso.codigo)}
                            isDimmed={prereqHighlight.isDimmed(curso.codigo)}
                            highlightModeActive={!!prereqHighlight.activeCourseCode}
                            editModeActive={editMode}
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
                            desasignando={
                              desasignarSlotMutation.isPending &&
                              desasignarSlotMutation.variables === curso.codigo
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

      {estudiante && (
        <AsignarCursoRealSheet
          carnet={estudiante.carnet}
          slotCodigo={slotAbierto}
          onOpenChange={(open) => {
            if (!open) setSlotAbierto(null)
          }}
        />
      )}
    </>
  )
}
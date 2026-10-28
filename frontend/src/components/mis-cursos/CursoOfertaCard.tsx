import { useState } from "react"
import { CalendarClock, GraduationCap, Hash, Users, X } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { EstadoOfertaBadge } from "@/components/shared/EstadoOfertaBadge"
import { resolverArea, codigoVisible } from "@/lib/curso-area"
import { useHorarioStore } from "@/store/horarioStore"
import type { CursoOferta, SeccionOferta } from "@/types/oferta"
import type { Seccion } from "@/types/seccion"

/** Adapta una sección de la oferta (backend) al tipo Seccion que ya usa
 * useHorarioStore -- el store no conoce CursoOferta, solo necesita los
 * datos planos de la sección elegida. */
function toSeccion(curso: CursoOferta, s: SeccionOferta): Seccion {
  return {
    nrc: s.nrc,
    codigoCurso: curso.codigo,
    titulo: curso.nombre,
    seccion: s.numeroSeccion,
    creditos: Number(curso.creditos),
    capacidad: s.capacidad,
    inscritos: s.inscritos,
    disponibles: s.disponibles,
    estadoOferta: s.estadoOferta,
    profesor: s.profesor ?? "Profesor por asignar",
    horarios: s.horarios,
  }
}

function resumenHorario(horarios: SeccionOferta["horarios"]): string {
  if (horarios.length === 0) return "Sin horario asignado"
  return horarios
    .map((h) => `${h.dia.slice(0, 3)} ${h.horaInicio}-${h.horaFin}`)
    .join(" · ")
}

/**
 * Detalle de una sección (profesor, horario, cupos opcional) con un
 * ícono semánticamente propio por campo -- reutilizado en los tres
 * lugares donde se muestra una sección (cursando, elegida, y cada
 * opción del selector), para que el vocabulario visual sea el mismo.
 * El nombre del curso no se repite acá -- ya está una vez arriba en
 * la card, y ahora también se ve en el bloque del mini-calendario.
 */
function DetalleSeccion({
  profesor,
  horarios,
  cupos,
  estadoOferta,
}: {
  profesor: string | null
  horarios: SeccionOferta["horarios"]
  cupos?: { disponibles: number; capacidad: number }
  estadoOferta?: string
}) {
  return (
    <>
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <GraduationCap className="size-3 shrink-0" />
        <span className="truncate">{profesor || "Profesor por asignar"}</span>
      </p>
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <CalendarClock className="size-3 shrink-0" />
        <span className="truncate">{resumenHorario(horarios)}</span>
      </p>
      {cupos && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="size-3 shrink-0" />
          {cupos.disponibles}/{cupos.capacidad} cupos
        </p>
      )}
      {estadoOferta === "agotada" && (
        <p className="flex items-center gap-1.5 text-muted-foreground italic">
          <Users className="size-3 shrink-0" />
          Sin cupo — no vista en la última actualización
        </p>
      )}
    </>
  )
}

interface CursoOfertaCardProps {
  curso: CursoOferta
  /** Quita un curso ya CONFIRMADO (estado "cursando", con efecto real en
   * la BD) -- distinto de quitar un pick de borrador, que es puramente
   * local (removerSeccionManual, sin llamada a la API). */
  onQuitarConfirmado: (codigo: string) => void
  quitandoConfirmado: boolean
  /** true si el estudiante ya alcanzó sus 4 Estudios Generales
   * (aprobados/cursando + borrador) -- deshabilita "Agregar sección"
   * para un general que todavía no tiene ninguna elegida. No aplica a
   * cursos que no son generales, ni a un general que el estudiante ya
   * eligió (puede seguir cambiando de sección). */
  limiteGeneralesAlcanzado: boolean
  /** Mismo criterio que limiteGeneralesAlcanzado, para el tope de
   * optativas de la carrera (dinámico, no siempre 4). */
  limiteOptativasAlcanzado: boolean
  /** Código del ciclo que se está viendo. Un curso "cursando" en OTRO
   * ciclo se muestra como tal pero no se puede quitar desde acá (sería
   * dar de baja la matrícula de ese otro ciclo). */
  periodoSeleccionado: string
}

export function CursoOfertaCard({
  curso,
  onQuitarConfirmado,
  quitandoConfirmado,
  limiteGeneralesAlcanzado,
  limiteOptativasAlcanzado,
  periodoSeleccionado,
}: CursoOfertaCardProps) {
  const [abierto, setAbierto] = useState(false)
  const area = resolverArea(curso.codigo)

  const seccionElegida = useHorarioStore((s) =>
    s.seccionesManuales.find((sec) => sec.codigoCurso === curso.codigo)
  )
  const agregarSeccionManual = useHorarioStore((s) => s.agregarSeccionManual)
  const reemplazarSeccionManual = useHorarioStore((s) => s.reemplazarSeccionManual)
  const removerSeccionManual = useHorarioStore((s) => s.removerSeccionManual)

  const haySoloUnaSeccion = curso.secciones.length <= 1
  const generalBloqueadoPorTope =
    curso.esGeneral && !seccionElegida && limiteGeneralesAlcanzado
  const optativaBloqueadaPorTope =
    curso.esOptativa && !seccionElegida && limiteOptativasAlcanzado
  const bloqueadoPorTope = generalBloqueadoPorTope || optativaBloqueadaPorTope
  const cursandoEnOtroPeriodo =
    curso.estado === "cursando" &&
    curso.periodoCursando !== null &&
    curso.periodoCursando.codigo !== periodoSeleccionado

  function elegirSeccion(s: SeccionOferta) {
    const nueva = toSeccion(curso, s)
    if (seccionElegida) {
      reemplazarSeccionManual(seccionElegida.nrc, nueva)
    } else {
      agregarSeccionManual(nueva)
    }
    setAbierto(false)
  }

  return (
    <Card
      className={`border-t-4 ${area.borderClassName} ${
        curso.estado === "bloqueado" ? "opacity-60" : ""
      }`}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-xs font-mono">
              {codigoVisible(curso.codigo)}
            </Badge>
            <Badge className={`text-xs border-transparent ${area.badgeClassName}`}>
              {area.label}
            </Badge>
          </div>
          <EstadoOfertaBadge estado={curso.estado} />
        </div>

        <p className="text-sm font-semibold leading-tight">{curso.nombre}</p>

        <div className="text-xs text-muted-foreground pt-1 border-t border-border/60">
          {curso.creditos} créditos
        </div>

        {curso.estado === "bloqueado" && curso.prerrequisitosFaltantes.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Requiere aprobar:{" "}
            <span className="font-medium text-foreground">
              {/* "(en curso)": ese prerrequisito está cursando y no cuenta
                  como aprobado -- el estudiante debe marcarlo en la Malla
                  cuando lo apruebe. */}
              {curso.prerrequisitosFaltantes
                .map((p) => `${codigoVisible(p.code)}${p.enCurso ? " (en curso)" : ""}`)
                .join(", ")}
            </span>
          </p>
        )}

        {curso.estado === "bloqueado" && curso.motivoBloqueo && (
          <p className="text-xs text-muted-foreground">{curso.motivoBloqueo}</p>
        )}

        {curso.corequisitos.length > 0 && (
          <p className="text-xs italic text-muted-foreground">
            Correquisito: {curso.corequisitos.map((c) => codigoVisible(c.code)).join(", ")}
          </p>
        )}

        {cursandoEnOtroPeriodo && (
          <p className="text-xs text-muted-foreground">
            Cursando en {curso.periodoCursando!.nombre}
          </p>
        )}

        {curso.estado === "cursando" && curso.seccionActual && !cursandoEnOtroPeriodo && (
          <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 font-mono font-semibold">
                <Hash className="size-3" />
                {curso.seccionActual.nrc}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                disabled={quitandoConfirmado}
                onClick={() => onQuitarConfirmado(curso.codigo)}
              >
                <X className="size-3" />
                {quitandoConfirmado ? "Quitando..." : "Quitar"}
              </Button>
            </div>
            <DetalleSeccion
              profesor={curso.seccionActual.profesor}
              horarios={curso.seccionActual.horarios}
            />
          </div>
        )}

        {curso.estado === "elegible" && (
          <Collapsible open={abierto} onOpenChange={setAbierto}>
            {seccionElegida ? (
              <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 font-mono font-semibold">
                    <Hash className="size-3" />
                    {seccionElegida.nrc}
                  </span>
                  <div className="flex items-center gap-1">
                    {!haySoloUnaSeccion && (
                      <CollapsibleTrigger asChild>
                        <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
                          Cambiar sección
                        </Button>
                      </CollapsibleTrigger>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs"
                      onClick={() => removerSeccionManual(seccionElegida.nrc)}
                    >
                      <X className="size-3" />
                      Quitar
                    </Button>
                  </div>
                </div>
                <DetalleSeccion
                  profesor={seccionElegida.profesor}
                  horarios={seccionElegida.horarios}
                />
              </div>
            ) : bloqueadoPorTope ? (
              <div className="rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground text-center">
                {generalBloqueadoPorTope
                  ? "Ya completaste tus 4 Estudios Generales"
                  : `Ya completaste tus ${curso.maximoOptativas} optativas`}
              </div>
            ) : (
              <CollapsibleTrigger asChild>
                <Button size="sm" className="w-full">
                  {curso.secciones.length > 1 ? "Elegir sección" : "Agregar sección"}
                </Button>
              </CollapsibleTrigger>
            )}

            <CollapsibleContent className="space-y-1.5 pt-2">
              {curso.secciones.map((s) => (
                <button
                  key={s.nrc}
                  type="button"
                  onClick={() => elegirSeccion(s)}
                  className="w-full rounded-md border border-border p-2 text-left text-xs transition-colors hover:bg-muted/60 space-y-1"
                >
                  <span className="flex items-center gap-1 font-mono font-semibold">
                    <Hash className="size-3" />
                    {s.nrc}
                  </span>
                  <DetalleSeccion
                    profesor={s.profesor}
                    horarios={s.horarios}
                    cupos={{ disponibles: s.disponibles, capacidad: s.capacidad }}
                    estadoOferta={s.estadoOferta}
                  />
                </button>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}

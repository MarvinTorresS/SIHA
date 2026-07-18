import { useMemo } from "react"
import { AlertTriangle, BookOpen, CalendarClock, GraduationCap } from "lucide-react"
import { useHorarioStore } from "@/store/horarioStore"
import { resolverArea, codigoVisible } from "@/lib/curso-area"

const DIAS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const
const HORA_INICIO = 7
const HORA_FIN = 22
const PX_POR_HORA = 48
// Margen superior parejo para TODOS los bloques -- sin esto, el bloque
// de las 7:00 (top: 0) queda pegado justo al borde de la grilla, más
// apretado que el resto (que ya tienen "aire" natural entre secciones).
// Se suma también a ALTO_TOTAL para no recortar el último bloque del
// día contra el borde inferior del contenedor (que sí tiene overflow-hidden).
const GAP_SUPERIOR = 6
const ALTO_TOTAL = (HORA_FIN - HORA_INICIO) * PX_POR_HORA + GAP_SUPERIOR

function minutosDesdeInicio(hora: string): number {
  const [h, m] = hora.split(":").map(Number)
  return (h - HORA_INICIO) * 60 + m
}

interface BloqueRenderizable {
  key: string
  nrc: string
  codigoCurso: string
  tituloCurso: string
  profesor: string
  horaInicio: string
  horaFin: string
  top: number
  height: number
  lane: number
}

/**
 * Asigna cada bloque a un "carril" horizontal dentro de su día -- algoritmo
 * clásico de "mínimo de salas de reunión" (greedy: el primer carril cuyo
 * último bloque ya terminó antes de que este empiece). Evita que dos
 * bloques que se solapan en el tiempo se dibujen exactamente encima uno
 * del otro, sin importar cuántos coincidan.
 */
function asignarCarriles(bloques: BloqueRenderizable[]): {
  items: BloqueRenderizable[]
  maxCarriles: number
} {
  const ordenados = [...bloques].sort((a, b) => a.top - b.top)
  const finPorCarril: number[] = []

  for (const b of ordenados) {
    let carril = finPorCarril.findIndex((fin) => fin <= b.top)
    if (carril === -1) {
      carril = finPorCarril.length
      finPorCarril.push(b.top + b.height)
    } else {
      finPorCarril[carril] = b.top + b.height
    }
    b.lane = carril
  }

  return { items: ordenados, maxCarriles: Math.max(finPorCarril.length, 1) }
}

/**
 * Calendario semanal Lunes-Domingo, 7:00-22:00, poblado en vivo con las
 * secciones seleccionadas (fijas -- cursos "cursando" -- + manuales, ver
 * useHorarioStore). Los bloques en conflicto se pintan en --warning
 * (ámbar), exclusivo de esta pantalla -- ver DESIGN.md.
 */
export function CalendarioSemanal() {
  const seccionesFijas = useHorarioStore((s) => s.seccionesFijas)
  const seccionesManuales = useHorarioStore((s) => s.seccionesManuales)
  const conflictos = useHorarioStore((s) => s.conflictos)

  const todasLasSecciones = useMemo(
    () => [...seccionesFijas.values(), ...seccionesManuales],
    [seccionesFijas, seccionesManuales]
  )

  // Por NRC, con qué otro(s) curso/NRC choca -- para el texto dentro del
  // bloque + tooltip. Se arma en ambas direcciones (A->B y B->A) porque
  // un conflicto solo se guarda una vez pero afecta a los dos bloques.
  const conflictoPorNrc = useMemo(() => {
    const map = new Map<string, { conCurso: string; conNrc: string }[]>()
    const agregar = (nrc: string, conCurso: string, conNrc: string) => {
      const lista = map.get(nrc) ?? []
      lista.push({ conCurso, conNrc })
      map.set(nrc, lista)
    }
    for (const c of conflictos) {
      agregar(c.seccionA.nrc, c.seccionB.codigoCurso, c.seccionB.nrc)
      agregar(c.seccionB.nrc, c.seccionA.codigoCurso, c.seccionA.nrc)
    }
    return map
  }, [conflictos])

  const bloquesPorDia = useMemo(() => {
    const porDia = new Map<string, BloqueRenderizable[]>()
    for (const dia of DIAS) porDia.set(dia, [])

    for (const seccion of todasLasSecciones) {
      for (const bloque of seccion.horarios) {
        if (!porDia.has(bloque.dia)) continue // día fuera de la grilla (no debería pasar)

        const top = minutosDesdeInicio(bloque.horaInicio) * (PX_POR_HORA / 60) + GAP_SUPERIOR
        const height =
          (minutosDesdeInicio(bloque.horaFin) - minutosDesdeInicio(bloque.horaInicio)) *
          (PX_POR_HORA / 60)

        porDia.get(bloque.dia)!.push({
          key: `${seccion.nrc}-${bloque.dia}-${bloque.horaInicio}`,
          nrc: seccion.nrc,
          codigoCurso: seccion.codigoCurso,
          tituloCurso: seccion.titulo,
          profesor: seccion.profesor,
          horaInicio: bloque.horaInicio,
          horaFin: bloque.horaFin,
          top,
          height,
          lane: 0,
        })
      }
    }
    return porDia
  }, [todasLasSecciones])

  const horas = useMemo(
    () => Array.from({ length: HORA_FIN - HORA_INICIO + 1 }, (_, i) => HORA_INICIO + i),
    []
  )

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="grid grid-cols-[52px_repeat(7,1fr)] border-b border-border">
        <div />
        {DIAS.map((dia) => (
          <div
            key={dia}
            className="border-l border-border px-1 py-2.5 text-center text-xs font-semibold"
          >
            {dia}
          </div>
        ))}
      </div>

      <div
        className="relative grid grid-cols-[52px_repeat(7,1fr)]"
        style={{ height: ALTO_TOTAL }}
      >
        <div className="relative">
          {horas.map((h) => (
            <div
              key={h}
              className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted-foreground"
              style={{ top: (h - HORA_INICIO) * PX_POR_HORA }}
            >
              {h}:00
            </div>
          ))}
        </div>

        {DIAS.map((dia) => {
          const { items, maxCarriles } = asignarCarriles(bloquesPorDia.get(dia) ?? [])

          return (
            <div key={dia} className="relative border-l border-border">
              {horas.map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-border/50"
                  style={{ top: (h - HORA_INICIO) * PX_POR_HORA }}
                />
              ))}

              {items.map((b) => {
                const area = resolverArea(b.codigoCurso)
                const chocaCon = conflictoPorNrc.get(b.nrc) ?? []
                const enConflicto = chocaCon.length > 0
                const ancho = 100 / maxCarriles
                const izquierda = b.lane * ancho
                // Alto mínimo para que TODA la información entre sin
                // cortarse: código, título (hasta 2 líneas), profesor
                // (hasta 2 líneas también -- se envuelve en vez de
                // truncar), NRC y horario -- hasta 7 líneas ~13px c/u +
                // padding, 8 si además hay que sumar "vs OTRO".
                // Legibilidad antes que compacidad -- el bloque crece
                // más allá de su franja horaria real si hace falta.
                const altoMinimo = enConflicto ? 124 : 110

                const bloqueEl = (
                  <div
                    className={`absolute rounded-md border px-1.5 py-1.5 text-[11px] leading-tight ${
                      enConflicto
                        ? "border-warning bg-warning-bg text-warning"
                        : `border-current ${area.badgeClassName}`
                    }`}
                    style={{
                      top: b.top,
                      // minHeight, no height fijo: si el profesor
                      // necesita más líneas de las estimadas, la caja
                      // debe crecer con el contenido real, no recortarlo
                      // ni dejarlo desbordar por encima del borde.
                      minHeight: Math.max(b.height, altoMinimo),
                      left: `${izquierda}%`,
                      width: `calc(${ancho}% - 4px)`,
                      zIndex: enConflicto ? 1 : undefined,
                    }}
                  >
                    {/* Grilla de 2 columnas (ícono, texto) para las 5
                        filas -- la columna de ícono tiene ancho FIJO
                        (20px, el mínimo que entra "NRC" sin partirse),
                        así el texto de cada fila arranca exactamente en
                        la misma posición horizontal sin importar qué
                        ícono (o texto corto tipo "NRC") tenga esa fila.
                        items-start: los íconos se alinean con la
                        PRIMERA línea de texto, no centrados verticalmente
                        contra bloques de texto de varias líneas. */}
                    <div className="grid grid-cols-[20px_1fr] gap-x-1.5 gap-y-1 items-start">
                      <span className="flex justify-center pt-0.5">
                        {enConflicto && <AlertTriangle className="size-3 shrink-0" />}
                      </span>
                      <span className="font-mono font-semibold">
                        {codigoVisible(b.codigoCurso)}
                      </span>

                      <BookOpen className="size-3 shrink-0 justify-self-center mt-0.5" />
                      <span className="font-medium line-clamp-2">{b.tituloCurso}</span>

                      <GraduationCap className="size-3 shrink-0 justify-self-center mt-0.5" />
                      {/* Sin line-clamp: algunos nombres de profesor
                          necesitan 3 líneas o más -- se prioriza mostrar
                          el nombre completo (el bloque ya puede crecer
                          más allá de altoMinimo si hace falta). */}
                      <span className="opacity-90">
                        {b.profesor || "Profesor por asignar"}
                      </span>

                      <span className="justify-self-center text-[10px] font-semibold pt-0.5">
                        NRC
                      </span>
                      <span className="truncate opacity-90">{b.nrc}</span>

                      <CalendarClock className="size-3 shrink-0 justify-self-center mt-0.5" />
                      <span className="truncate opacity-80">
                        {b.horaInicio}–{b.horaFin}
                      </span>

                      {enConflicto && (
                        <>
                          <AlertTriangle className="size-3 shrink-0 justify-self-center mt-0.5" />
                          <span className="font-semibold">
                            vs {chocaCon.map((c) => codigoVisible(c.conCurso)).join(", ")}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )

                return <div key={b.key}>{bloqueEl}</div>
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

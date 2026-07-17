import type { PrerequisiteLine } from "@/hooks/usePrerequisiteHighlight"

interface PrerequisiteLinesOverlayProps {
  active: boolean
  lines: PrerequisiteLine[]
}

/**
 * Capa SVG absoluta sobre el grid de la malla, con una curva por cada
 * prerrequisito/correquisito → curso resaltado. Puramente decorativa
 * (pointer-events: none en su totalidad) -- cerrar el resaltado se hace
 * tocando de nuevo la tarjeta activa (toggleCourse), no hay botón propio.
 *
 * Prerrequisito: línea sólida + flecha (relación direccional, A antes
 * que B). Correquisito: línea punteada, sin flecha (simultáneo, sin
 * dirección real que representar -- ver prerrequisito.service.ts en el
 * backend, que ya deduplica y busca en ambas columnas).
 */
export function PrerequisiteLinesOverlay({
  active,
  lines,
}: PrerequisiteLinesOverlayProps) {
  if (!active) return null

  return (
    // z-30: por encima del AccordionTrigger (z-20, ver MallaPage.tsx) a
    // pedido explícito -- la línea debe verse siempre por delante, aunque
    // cruce el texto de un header al conectar tarjetas de ciclos distintos.
    <svg
      className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <marker
          id="prereq-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="fill-prereq-link" />
        </marker>
      </defs>
      {lines.map((line) => {
        // Curva horizontal clásica de diagrama de flujo: los puntos de
        // control quedan en el punto medio horizontal entre origen y
        // destino, tomando cada uno la altura de su propio extremo.
        const midX = (line.from.x + line.to.x) / 2
        const path = `M ${line.from.x},${line.from.y} C ${midX},${line.from.y} ${midX},${line.to.y} ${line.to.x},${line.to.y}`
        const esCorequisito = line.type === "correquisito"
        return (
          <path
            key={line.id}
            d={path}
            fill="none"
            className="stroke-prereq-link"
            strokeWidth={2}
            strokeDasharray={esCorequisito ? "5 4" : undefined}
            markerEnd={esCorequisito ? undefined : "url(#prereq-arrow)"}
          />
        )
      })}
    </svg>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { prerequisitosService } from "@/services/prerequisito.service"

export interface PrerequisiteLine {
  id: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  /**
   * "prerequisito": línea sólida con flecha (dirección real, A necesita
   * B aprobado antes). "correquisito": punteada sin flecha (simultáneo,
   * sin dirección -- ver PrerequisiteLinesOverlay.tsx).
   */
  type: "prerequisito" | "correquisito"
}

// Cuánto se mete el punto hacia adentro del borde real de la tarjeta,
// en vez de caer exactamente sobre él. Necesario porque una tarjeta que
// es la primera de su AccordionItem queda con su borde superior tocando
// -- sin ningún margen -- el AccordionTrigger de esa misma sección
// (z-20, opaco, a propósito: ver comentario en MallaPage.tsx). El
// <marker> (markerWidth=7 x strokeWidth=2 = 14px renderizados, refY=5
// centrado) se extiende ~7px arriba y ~7px abajo del punto que calcula
// edgePoint() -- con un inset de solo 8px el margen real quedaba en
// ~1px, que se pierde en el antialiasing. 16px deja ~9px de margen real
// más allá del propio marker.
const EDGE_INSET = 16

/**
 * Punto sobre el borde de un rectángulo, en la dirección (dx, dy) desde
 * su centro -- para que las líneas salgan del borde real de la tarjeta
 * en vez de nacer en su centro (se vería como si atravesaran el texto).
 * Se mete EDGE_INSET px hacia adentro del borde real para no compartir
 * pixel exacto con un elemento adyacente (ver EDGE_INSET).
 */
function edgePoint(
  rect: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number
): { x: number; y: number } {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  if (dx === 0 && dy === 0) return { x: cx, y: cy }

  const halfW = Math.max(rect.width / 2 - EDGE_INSET, 0)
  const halfH = Math.max(rect.height / 2 - EDGE_INSET, 0)
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity
  const scale = Math.min(scaleX, scaleY)

  return { x: cx + dx * scale, y: cy + dy * scale }
}

/**
 * Resaltado in-place de prerrequisitos directos sobre la malla real --
 * sin modal, sin librería de grafos. Un click en una tarjeta trae sus
 * prerrequisitos directos (?profundidad=directo) y calcula, contra las
 * posiciones reales de las tarjetas en el DOM, las líneas que las
 * conectan. Disponible para cualquier carrera -- solo lee estructura
 * curricular, no depende del historial del estudiante.
 */
export function usePrerequisiteHighlight() {
  const [activeCourseCode, setActiveCourseCode] = useState<string | null>(null)

  const {
    data: prerequisiteTree,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["prerrequisitos-directos", activeCourseCode],
    queryFn: () => prerequisitosService.obtenerDirectos(activeCourseCode!),
    enabled: !!activeCourseCode,
  })

  const toggleCourse = useCallback((codigo: string) => {
    setActiveCourseCode((current) => (current === codigo ? null : codigo))
  }, [])

  const closeHighlight = useCallback(() => setActiveCourseCode(null), [])

  // Referencias a los elementos reales de las tarjetas, indexadas por
  // código de curso -- viven en un Map porque las tarjetas se registran
  // y desregistran dinámicamente según qué ciclos están montados.
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const registerCardRef = useCallback((codigo: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(codigo, el)
    else cardRefs.current.delete(codigo)
  }, [])

  const containerRef = useRef<HTMLElement>(null)
  const [lines, setLines] = useState<PrerequisiteLine[]>([])

  const prerequisiteCodes = useMemo(
    () => new Set(prerequisiteTree?.requires.map((r) => r.code) ?? []),
    [prerequisiteTree]
  )

  const corequisiteCodes = useMemo(
    () => new Set(prerequisiteTree?.corequisitos.map((c) => c.code) ?? []),
    [prerequisiteTree]
  )

  const hasMoreRequirementsByCode = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const req of prerequisiteTree?.requires ?? []) {
      map.set(req.code, req.hasMoreRequirements)
    }
    return map
  }, [prerequisiteTree])

  const highlightedCodes = useMemo(() => {
    if (!activeCourseCode) return new Set<string>()
    return new Set([activeCourseCode, ...prerequisiteCodes, ...corequisiteCodes])
  }, [activeCourseCode, prerequisiteCodes, corequisiteCodes])

  // Recalcula las coordenadas de las líneas contra las posiciones reales
  // en el DOM. Se dispara al cambiar los datos resaltados, en resize de
  // ventana (las tarjetas pueden reubicarse en responsive), y con un
  // ResizeObserver sobre el contenedor: cubre la animación de apertura
  // del accordion (el prerrequisito puede vivir en un ciclo recién
  // expandido) reaccionando al cambio de tamaño real en vez de adivinar
  // cuánto dura la animación con un setTimeout fijo -- si Radix tarda más
  // de lo esperado, un timeout fijo deja la línea apuntando a la posición
  // vieja de la tarjeta, que ya se movió a su lugar final.
  useEffect(() => {
    function recalculateLines() {
      const container = containerRef.current
      const totalConexiones = prerequisiteCodes.size + corequisiteCodes.size
      if (!container || !activeCourseCode || totalConexiones === 0) {
        setLines([])
        return
      }

      const activeEl = cardRefs.current.get(activeCourseCode)
      if (!activeEl) {
        setLines([])
        return
      }

      const containerRect = container.getBoundingClientRect()
      const toDOMRect = (el: HTMLElement) => {
        const r = el.getBoundingClientRect()
        return {
          x: r.left - containerRect.left,
          y: r.top - containerRect.top,
          width: r.width,
          height: r.height,
        }
      }

      const activeRect = toDOMRect(activeEl)
      const activeCenter = {
        x: activeRect.x + activeRect.width / 2,
        y: activeRect.y + activeRect.height / 2,
      }

      function lineasPara(
        codigos: Set<string>,
        type: PrerequisiteLine["type"]
      ): PrerequisiteLine[] {
        const resultado: PrerequisiteLine[] = []
        for (const codigo of codigos) {
          const otroEl = cardRefs.current.get(codigo)
          if (!otroEl) continue

          const otroRect = toDOMRect(otroEl)
          const otroCenter = {
            x: otroRect.x + otroRect.width / 2,
            y: otroRect.y + otroRect.height / 2,
          }

          const dx = activeCenter.x - otroCenter.x
          const dy = activeCenter.y - otroCenter.y

          resultado.push({
            id: `${type}-${codigo}`,
            from: edgePoint(otroRect, dx, dy),
            to: edgePoint(activeRect, -dx, -dy),
            type,
          })
        }
        return resultado
      }

      setLines([
        ...lineasPara(prerequisiteCodes, "prerequisito"),
        ...lineasPara(corequisiteCodes, "correquisito"),
      ])
    }

    recalculateLines()

    // ResizeObserver sobre el contenedor: dispara en CUALQUIER cambio de
    // tamaño real (animación del accordion terminando, contenido
    // cargando, cambios de layout responsive), sin depender de una
    // duración fija adivinada.
    const resizeObserver = new ResizeObserver(recalculateLines)
    resizeObserver.observe(containerRef.current!)

    // Scroll además: en mobile el viewport visual cambia de tamaño al
    // scrollear (barra de URL que aparece/desaparece), lo que corre las
    // coordenadas calculadas aunque el contenido no se mueva relativo al
    // contenedor -- esto no dispara ResizeObserver porque el contenedor
    // en sí no cambia de tamaño.
    window.addEventListener("resize", recalculateLines)
    window.addEventListener("scroll", recalculateLines, { passive: true })
    containerRef.current?.addEventListener("scroll", recalculateLines, {
      passive: true,
    })
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", recalculateLines)
      window.removeEventListener("scroll", recalculateLines)
      containerRef.current?.removeEventListener("scroll", recalculateLines)
    }
  }, [activeCourseCode, prerequisiteCodes, corequisiteCodes])

  return {
    activeCourseCode,
    toggleCourse,
    closeHighlight,
    registerCardRef,
    containerRef,
    lines,
    isLoading,
    error,
    isHighlighted: (codigo: string) => highlightedCodes.has(codigo),
    isDimmed: (codigo: string) => !!activeCourseCode && !highlightedCodes.has(codigo),
    hasMoreRequirements: (codigo: string) => hasMoreRequirementsByCode.get(codigo) ?? false,
  }
}

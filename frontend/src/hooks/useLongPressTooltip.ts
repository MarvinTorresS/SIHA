import { useCallback, useRef, useState } from "react"

const LONG_PRESS_MS = 500

/**
 * Tooltip descubrible sobre una tarjeta clickeable: hover normal en
 * desktop (comportamiento nativo de Radix, sin tocar), y long-press en
 * touch (~500ms) en dispositivos que no tienen hover. El long-press no
 * debe disparar además el click normal de la tarjeta -- shouldSuppressClick
 * se consulta una vez desde el onClick y se resetea sola.
 *
 * @param disabled  cuando es true (ej. la tarjeta ya está resaltada), no
 *                  se abre el tooltip por ningún medio.
 */
export function useLongPressTooltip(disabled: boolean) {
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleTouchStart = useCallback(() => {
    if (disabled) return
    longPressFiredRef.current = false
    timerRef.current = setTimeout(() => {
      longPressFiredRef.current = true
      setOpen(true)
    }, LONG_PRESS_MS)
  }, [disabled])

  const handleTouchEnd = useCallback(() => {
    clearTimer()
    if (longPressFiredRef.current) setOpen(false)
  }, [clearTimer])

  // Se llama desde el onClick de la tarjeta: si el toque actual fue un
  // long-press, consume el click una vez (no togglea el resaltado) y
  // resetea la bandera para el próximo gesto.
  const shouldSuppressClick = useCallback(() => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false
      return true
    }
    return false
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (disabled) return
      setOpen(next)
    },
    [disabled]
  )

  return {
    open: disabled ? false : open,
    onOpenChange: handleOpenChange,
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchEnd,
    shouldSuppressClick,
  }
}

import { CalendarRange } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import type { Periodo } from "@/types/periodo"

interface PeriodoSelectProps {
  periodos: (Periodo & { finalizado?: boolean })[]
  periodo: Periodo | undefined
  onChange: (codigo: string) => void
  isLoading?: boolean
  className?: string
}

/**
 * Selector de ciclo lectivo, puramente visual: Mis Cursos le pasa los
 * ciclos activos (usePeriodoSeleccionado) y Mi Horario además los
 * finalizados con matrícula (usePeriodoHorario), rotulados "(finalizado)".
 */
export function PeriodoSelect({ periodos, periodo, onChange, isLoading, className }: PeriodoSelectProps) {
  if (isLoading || !periodo) {
    return <Skeleton className={`h-9 w-full ${className ?? ""}`} />
  }

  return (
    <Select value={periodo.codigo} onValueChange={onChange}>
      <SelectTrigger className={`w-full ${className ?? ""}`} aria-label="Ciclo lectivo">
        <span className="flex min-w-0 items-center gap-2">
          <CalendarRange className="size-4 shrink-0 text-muted-foreground" />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {periodos.map((p) => (
          <SelectItem key={p.codigo} value={p.codigo}>
            {p.nombre}
            {p.finalizado ? " (finalizado)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

import { CalendarRange } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { usePeriodoSeleccionado } from "@/hooks/usePeriodoSeleccionado"

/**
 * Selector de ciclo lectivo compartido por Mis Cursos y Mi Horario. La
 * selección vive en usePeriodoStore (recordada entre visitas), así que
 * cambiarla en una pantalla también la cambia en la otra.
 */
export function PeriodoSelect({ className }: { className?: string }) {
  const { periodos, periodo, setPeriodo, isLoading } = usePeriodoSeleccionado()

  if (isLoading || !periodo) {
    return <Skeleton className={`h-9 w-full ${className ?? ""}`} />
  }

  return (
    <Select value={periodo.codigo} onValueChange={setPeriodo}>
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
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

import { CheckCircle2, Clock, Unlock, Lock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { EstadoOferta } from "@/types/oferta"

/**
 * Vocabulario visual de los 4 estados de Mis Cursos. Reutiliza EXACTAMENTE
 * los tokens de EstadoBadge para "aprobado"/"cursando" -- son el mismo
 * significado en cualquier pantalla (ver DESIGN.md, "Estado Badge").
 * "elegible" reutiliza el token de "pendiente" (azul UNA, secondary):
 * es la misma idea de "todavía no cursado", ahora con acción disponible.
 * "bloqueado" usa gris muted -- no es un error ni un conflicto, solo una
 * condición sin cumplir; el ámbar queda exclusivo para choques de horario.
 */
interface EstadoOfertaConfig {
  label: string
  icon: React.ElementType
  badgeClassName: string
}

const ESTADO_CONFIG: Record<EstadoOferta, EstadoOfertaConfig> = {
  aprobado: {
    label: "Aprobado",
    icon: CheckCircle2,
    badgeClassName: "border-transparent bg-success-bg text-success",
  },
  cursando: {
    label: "Cursando",
    icon: Clock,
    badgeClassName: "border-transparent bg-estado-cursando-bg text-estado-cursando",
  },
  elegible: {
    label: "Elegible",
    icon: Unlock,
    badgeClassName: "border-transparent bg-secondary text-secondary-foreground",
  },
  bloqueado: {
    label: "Bloqueado",
    icon: Lock,
    badgeClassName: "border-transparent bg-muted text-muted-foreground",
  },
}

export function EstadoOfertaBadge({ estado }: { estado: EstadoOferta }) {
  const config = ESTADO_CONFIG[estado]
  const Icon = config.icon
  return (
    <Badge className={`${config.badgeClassName} gap-1`}>
      <Icon className="size-3" />
      {config.label}
    </Badge>
  )
}

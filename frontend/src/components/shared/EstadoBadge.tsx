import { CheckCircle2, Clock, AlertTriangle, Lock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { EstadoCursoProgreso } from "@/types/estudiante"

/**
 * Vocabulario visual de los 4 estados de curso -- compartido entre
 * Dashboard, Malla Curricular y, cuando se construya, Mi Horario (ver
 * DESIGN.md, "Estado Badge (componente de firma)": su color debe leerse
 * igual en cualquier pantalla donde aparezca).
 *
 * IMPORTANTE (regla de marca UNA): el ámbar (--warning) está reservado
 * exclusivamente para conflictos de horario en Mi Horario. Por eso
 * "sin_seccion" usa violeta, no ámbar.
 */
interface EstadoConfig {
  label: string
  icon: React.ElementType
  badgeClassName: string
}

const ESTADO_CONFIG: Record<EstadoCursoProgreso, EstadoConfig> = {
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
  pendiente: {
    label: "Pendiente",
    icon: Lock,
    badgeClassName: "border-transparent bg-secondary text-secondary-foreground",
  },
  sin_seccion: {
    label: "Sin sección",
    icon: AlertTriangle,
    badgeClassName:
      "border-transparent bg-estado-sin-seccion-bg text-estado-sin-seccion",
  },
}

/** Orden de despliegue estable para leyendas -- no depender de Object.keys. */
export const ESTADOS_CURSO: EstadoCursoProgreso[] = [
  "aprobado",
  "cursando",
  "pendiente",
  "sin_seccion",
]

export function estadoConfig(estado: EstadoCursoProgreso): EstadoConfig {
  return ESTADO_CONFIG[estado]
}

export function EstadoBadge({ estado }: { estado: EstadoCursoProgreso }) {
  const config = ESTADO_CONFIG[estado]
  const Icon = config.icon
  return (
    <Badge className={`${config.badgeClassName} gap-1`}>
      <Icon className="size-3" />
      {config.label}
    </Badge>
  )
}

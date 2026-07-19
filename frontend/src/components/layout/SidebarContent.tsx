import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  CalendarDays,
  BookOpen,
  ListChecks,
  LogOut,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/authStore"

interface NavItem {
  to: string
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  {
    to: "/",
    label: "Dashboard",
    description: "Resumen general",
    icon: LayoutDashboard,
  },
  {
    to: "/horario",
    label: "Mi Horario",
    description: "Vista semanal",
    icon: CalendarDays,
  },
  {
    to: "/malla",
    label: "Malla Curricular",
    description: "Avance por ciclo",
    icon: BookOpen,
  },
  {
    to: "/mis-cursos",
    label: "Mis Cursos",
    description: "Cursos asignados",
    icon: ListChecks,
  },
]

/**
 * Contenido del sidebar, sin el contenedor de posicionamiento (eso lo
 * define quien lo use: fijo en desktop dentro de AppShell, o dentro
 * de un SheetContent en mobile). Así evitamos duplicar la lista de
 * navegación en dos componentes distintos.
 */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const estudiante = useAuthStore((s) => s.estudiante)
  const logout = useAuthStore((s) => s.logout)

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Marca institucional -- marca más grande y con más peso que el
          badge chico de antes (size-9 -> size-10, tracking en el ícono),
          "SIHA" en font-bold text-base en vez de font-semibold text-sm:
          es el único logo de la app, debe leerse como un punto de
          identidad, no como un ícono de relleno. */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-xs tracking-wide">
          UNA
        </div>
        <div>
          <p className="text-base font-bold leading-none tracking-tight">SIHA</p>
          <p className="text-xs text-muted-foreground">Campus Coto</p>
        </div>
      </div>

      <div className="mx-4 mb-2 border-t border-sidebar-border" />

      {/* Navegación -- el ítem activo antes solo tenía un tinte al 10% de
          opacidad (el estado activo más genérico que existe, el default
          de cualquier template de admin). Ahora es un fill sólido de
          Rojo UNA -- uso legítimo del acento de marca para acción/
          navegación activa, no decoración (ver DESIGN.md). La
          descripción desaparece en el ítem activo (ya sabés dónde
          estás, no hace falta repetirlo) y el label sube a font-semibold
          -- esa es la amplificación de jerarquía: el resto de la lista
          queda deliberadamente más callada en contraste, no porque se
          le quitó nada, sino porque el activo ahora pesa más. */}
      <nav className="flex flex-1 flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-primary text-primary-foreground font-semibold shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent"
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn("shrink-0", isActive ? "size-5" : "size-4")} />
                <span className="flex flex-col">
                  <span className="leading-none">{item.label}</span>
                  {!isActive && (
                    <span className="text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Usuario */}
      {estudiante && (
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground text-xs font-semibold ring-1 ring-sidebar-border">
              {estudiante.nombre
                .split(" ")
                .slice(0, 2)
                .map((n) => n[0])
                .join("")}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-none">
                {estudiante.nombre}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {estudiante.carnet}
              </p>
            </div>
            <button
              onClick={logout}
              aria-label="Cerrar sesión"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

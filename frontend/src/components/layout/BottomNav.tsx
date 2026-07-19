import { NavLink } from "react-router-dom"
import { LayoutDashboard, CalendarDays, BookOpen, ListChecks } from "lucide-react"

import { cn } from "@/lib/utils"

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

// Mismos 4 destinos e íconos que SidebarContent.NAV_ITEMS -- sin la
// descripción larga, acá no entra.
const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/horario", label: "Horario", icon: CalendarDays },
  { to: "/malla", label: "Malla", icon: BookOpen },
  { to: "/mis-cursos", label: "Cursos", icon: ListChecks },
]

/**
 * Navegación inferior fija, solo mobile (reemplaza al drawer del
 * sidebar en ese breakpoint -- ver Sidebar.tsx). z-40, por encima del
 * Header (z-30) porque es chrome global persistente, no algo propio de
 * una pantalla.
 */
export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Navegación principal"
    >
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) =>
            cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors",
              isActive
                ? "text-primary font-medium"
                : "text-muted-foreground"
            )
          }
        >
          <item.icon className="size-5" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

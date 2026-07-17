import { useEffect } from "react"
import { Outlet } from "react-router-dom"

import { DesktopSidebar, MobileSidebar } from "./Sidebar"
import { useThemeStore } from "@/store/themeStore"

/**
 * Layout raíz de la app autenticada. Compone:
 * - DesktopSidebar: fijo, oculto en mobile (md:hidden se maneja adentro)
 * - MobileSidebar: drawer que se abre con el botón hamburguesa del Header
 * - <Outlet />: la página activa según la ruta (Dashboard, Horario, etc.)
 *
 * Cada página es responsable de renderizar su propio <Header title=.../>,
 * para poder pasar título/acciones específicas de esa pantalla.
 *
 * Punto único donde se sincroniza el tema persistido (useThemeStore) con
 * la clase "dark" en <html> -- Tailwind v4 la usa como selector para
 * activar el bloque .dark de index.css.
 */
export function AppShell() {
  const theme = useThemeStore((s) => s.theme)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  return (
    <div className="flex min-h-svh bg-muted/30">
      <DesktopSidebar />
      <MobileSidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}

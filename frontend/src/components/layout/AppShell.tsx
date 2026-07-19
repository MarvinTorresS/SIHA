import { useEffect } from "react"
import { Outlet } from "react-router-dom"

import { DesktopSidebar } from "./Sidebar"
import { BottomNav } from "./BottomNav"
import { useThemeStore } from "@/store/themeStore"

/**
 * Layout raíz de la app autenticada. Compone:
 * - DesktopSidebar: fijo, oculto en mobile (md:hidden se maneja adentro)
 * - BottomNav: navegación fija inferior, solo mobile (reemplaza al
 *   drawer que tenía el sidebar antes -- BottomNav cubre los mismos 4
 *   destinos sin necesitar un botón de menú aparte)
 * - <Outlet />: la página activa según la ruta (Dashboard, Horario, etc.)
 *
 * Cada página es responsable de renderizar su propio <Header title=.../>,
 * para poder pasar título/acciones específicas de esa pantalla. El propio
 * Header absorbe, solo en mobile, la marca y el bloque de ciclo/usuario
 * que en desktop vive en el sidebar -- ver Header.tsx.
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

      {/* pb-16: dejar espacio para que BottomNav (fixed) no tape el
          final del contenido en mobile. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden pb-16 md:pb-0">
        <Outlet />
      </div>

      <BottomNav />
    </div>
  )
}

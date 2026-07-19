import { LogOut, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAuthStore } from "@/store/authStore"
import { useThemeStore } from "@/store/themeStore"

interface HeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

/**
 * Header superior. El título/descripción los define cada página
 * (ej. "Dashboard · Ingeniería en Sistemas de Información · I Ciclo 2026"),
 * consistente con el patrón visto en el diseño de Figma.
 *
 * En mobile (sin sidebar visible -- reemplazado por BottomNav) este
 * componente absorbe dos cosas que antes vivían en el sidebar: la marca
 * "SIHA" (arriba, en vez del botón de hamburguesa que abría el drawer
 * -- ya no existe drawer, BottomNav cubre los 4 destinos) y una fila de
 * usuario + logout (abajo). Se arma solo con datos de useAuthStore, así
 * que ninguna página necesita pasar props nuevas.
 */
export function Header({ title, description, actions }: HeaderProps) {
  const estudiante = useAuthStore((s) => s.estudiante)
  const logout = useAuthStore((s) => s.logout)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background">
      {/* flex-wrap, no una fila rígida: cuando una página pasa `actions`
          pesado (ej. Malla: selector de carrera + botón de modo edición),
          ese grupo no entra junto al título en una pantalla angosta.
          Antes el título absorbía todo el apriete (min-w-0 + truncate,
          sin piso) y terminaba cortado a "Ma...". Con min-w en el título
          y el grupo de la derecha como una sola unidad shrink-0, el
          navegador banca todo el trabajo: si no entra en una fila, el
          grupo entero salta a la siguiente -- nunca se parte a la mitad
          entre el selector y el botón. En desktop hay espacio de sobra,
          así que nunca llega a envolver -- no hace falta ningún md:
          explícito para "volver" a una fila. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 md:px-6">
        {/* Marca, solo mobile -- en desktop el logo ya vive en el sidebar
            fijo, duplicarlo acá sería ruido. */}
        <div className="flex shrink-0 items-center gap-2 md:hidden">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-[10px]">
            UNA
          </div>
        </div>

        <div className="min-w-44 flex-1">
          <h1 className="truncate text-lg font-semibold leading-tight">
            {title}
          </h1>
          {description && (
            <p className="truncate text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Activar modo oscuro" : "Activar modo claro"}
          >
            {theme === "light" ? (
              <Moon className="size-5" />
            ) : (
              <Sun className="size-5" />
            )}
          </Button>
        </div>
      </div>

      {/* Usuario, solo mobile -- en desktop esto vive en el sidebar fijo
          (SidebarContent), no hay que duplicarlo. */}
      {estudiante && (
        <div className="flex min-w-0 items-center gap-2 border-t border-border px-4 py-2 md:hidden">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground text-xs font-semibold">
            {estudiante.nombre
              .split(" ")
              .slice(0, 2)
              .map((n) => n[0])
              .join("")}
          </div>
          <p className="truncate text-sm font-medium">{estudiante.nombre}</p>
          <button
            onClick={logout}
            aria-label="Cerrar sesión"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      )}
    </header>
  )
}

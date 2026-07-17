import { Menu, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useUiStore } from "@/store/uiStore"
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
 */
export function Header({ title, description, actions }: HeaderProps) {
  const toggleMobileSidebar = useUiStore((s) => s.toggleMobileSidebar)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={toggleMobileSidebar}
        aria-label="Abrir menú"
      >
        <Menu className="size-5" />
      </Button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold leading-tight">
          {title}
        </h1>
        {description && (
          <p className="truncate text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
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
    </header>
  )
}

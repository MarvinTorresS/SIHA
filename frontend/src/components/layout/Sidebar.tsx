import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { useUiStore } from "@/store/uiStore"
import { SidebarContent } from "./SidebarContent"

/** Sidebar fijo, visible solo en viewports md+ (desktop/tablet). */
export function DesktopSidebar() {
  return (
    <aside className="hidden md:block w-64 shrink-0 border-r border-sidebar-border">
      <div className="fixed h-svh w-64">
        <SidebarContent />
      </div>
    </aside>
  )
}

/** Drawer lateral con el mismo contenido, visible solo en mobile. */
export function MobileSidebar() {
  const isOpen = useUiStore((s) => s.isMobileSidebarOpen)
  const closeMobileSidebar = useUiStore((s) => s.closeMobileSidebar)

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeMobileSidebar()}>
      <SheetContent side="left" className="w-72 p-0">
        {/* Título accesible oculto visualmente: el header visual ya
            está dentro de SidebarContent, esto es solo para lectores
            de pantalla (Radix Dialog requiere un título). */}
        <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
        <SidebarContent onNavigate={closeMobileSidebar} />
      </SheetContent>
    </Sheet>
  )
}

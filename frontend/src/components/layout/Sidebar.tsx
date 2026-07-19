import { SidebarContent } from "./SidebarContent"

/** Sidebar fijo, visible solo en viewports md+ (desktop/tablet). En
 * mobile la navegación vive en BottomNav -- ver AppShell.tsx. */
export function DesktopSidebar() {
  return (
    <aside className="hidden md:block w-64 shrink-0 border-r border-sidebar-border">
      <div className="fixed h-svh w-64">
        <SidebarContent />
      </div>
    </aside>
  )
}

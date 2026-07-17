import { Header } from "@/components/layout/Header"

export function MisCursosPage() {
  return (
    <>
      <Header title="Mis Cursos" description="Cursos asignados" />
      <main className="flex-1 p-4 md:p-6">
        <p className="text-sm text-muted-foreground">
          Lista de cursos asignados + selección manual de optativos —
          pendiente.
        </p>
      </main>
    </>
  )
}

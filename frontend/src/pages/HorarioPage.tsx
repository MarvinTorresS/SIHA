import { Header } from "@/components/layout/Header"
import { useAuthStore } from "@/store/authStore"

export function HorarioPage() {
  const estudiante = useAuthStore((s) => s.estudiante)

  return (
    <>
      <Header
        title="Mi Horario"
        description={
          estudiante
            ? `${estudiante.carrera.nombre} · ${estudiante.cicloActualId || "sin ciclo asignado"}`
            : undefined
        }
      />
      <main className="flex-1 p-4 md:p-6">
        <p className="text-sm text-muted-foreground">
          Calendario semanal — pendiente (Sprint 6, siguiente paso).
        </p>
      </main>
    </>
  )
}

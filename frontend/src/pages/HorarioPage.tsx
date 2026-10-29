import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { CalendarClock, ClipboardList } from "lucide-react"
import { Header } from "@/components/layout/Header"
import { CalendarioSemanalGrid } from "@/components/shared/CalendarioSemanalGrid"
import { PeriodoSelect } from "@/components/shared/PeriodoSelect"
import { usePeriodoHorario } from "@/hooks/usePeriodoSeleccionado"
import { useAuthStore } from "@/store/authStore"
import { miHorarioService } from "@/services/mi-horario.service"
import { ApiError } from "@/services/api"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"

/**
 * Mi Horario -- pantalla independiente, accesible en cualquier momento:
 * lee las secciones "cursando" del ciclo seleccionado directo de
 * historial_curso (no depende de pasar por Mis Cursos ni de la oferta).
 * El ciclo es el mismo que el de Mis Cursos (usePeriodoStore), pero acá
 * también se ofrecen los ciclos finalizados donde el estudiante todavía
 * tiene cursos "cursando", en solo lectura (esta pantalla no tiene
 * acciones: ni quitar, ni agregar, ni validar conflictos). Layout de un
 * solo panel: solo el calendario, a diferencia de Mis Cursos que además
 * tiene la lista de cursos al lado -- acá no hay nada que elegir, solo
 * consultar lo ya confirmado.
 */
export function HorarioPage() {
  const estudiante = useAuthStore((s) => s.estudiante)

  const {
    periodos,
    periodo,
    setPeriodo,
    isLoading: isLoadingPeriodos,
    error: errorPeriodos,
  } = usePeriodoHorario(estudiante?.carnet)

  const { data, isLoading, error: errorSecciones } = useQuery({
    queryKey: ["secciones-cursando", estudiante?.carnet, periodo?.codigo],
    queryFn: () =>
      miHorarioService.obtenerSeccionesCursando(estudiante!.carnet, periodo!.codigo),
    enabled: !!estudiante && !!periodo,
  })
  const error = errorSecciones ?? errorPeriodos

  const creditosTotales =
    data?.reduce((sum, s) => sum + Number(s.creditos), 0) ?? 0

  return (
    <>
      <Header
        title="Mi Horario"
        description={estudiante?.carrera.nombre}
      />
      <main className="flex-1 p-4 md:p-6 space-y-4">
        <PeriodoSelect
          periodos={periodos}
          periodo={periodo}
          onChange={setPeriodo}
          isLoading={isLoadingPeriodos}
          className="sm:max-w-xs"
        />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {import.meta.env.DEV
                ? error instanceof ApiError
                  ? `${error.status}: ${error.message}`
                  : "No se pudo conectar con la API. ¿Está corriendo en localhost:3000?"
                : "No pudimos cargar tu horario. Intenta de nuevo más tarde."}
            </AlertDescription>
          </Alert>
        )}

        {(isLoading || isLoadingPeriodos) && (
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-[600px] w-full" />
            </CardContent>
          </Card>
        )}

        {data && data.length === 0 && (
          <Card className="max-w-md mx-auto mt-12">
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <CalendarClock className="size-10 text-muted-foreground" />
              <div className="space-y-1">
                <p className="font-semibold">
                  No tenés cursos matriculados en {periodo?.nombre}
                </p>
                <p className="text-sm text-muted-foreground">
                  Cuando confirmes tu matrícula de este ciclo en Mis Cursos, tu
                  horario semanal con NRC, profesor y bloques va a aparecer acá.
                </p>
              </div>
              <Button asChild className="mt-2 gap-1.5">
                <Link to="/mis-cursos">
                  <ClipboardList className="size-4" />
                  Ir a Mis Cursos
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {data && data.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground">
              {data.length} {data.length === 1 ? "curso" : "cursos"} · {creditosTotales} créditos
              {periodo?.finalizado && " · Ciclo finalizado, solo lectura"}
            </p>
            <CalendarioSemanalGrid secciones={data} />
          </>
        )}
      </main>
    </>
  )
}

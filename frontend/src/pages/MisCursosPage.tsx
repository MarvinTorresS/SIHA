import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { CheckCircle2, ChevronRight, Search } from "lucide-react"
import { Header } from "@/components/layout/Header"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CursoOfertaCard } from "@/components/mis-cursos/CursoOfertaCard"
import { CalendarioSemanal } from "@/components/mis-cursos/CalendarioSemanal"
import { PeriodoSelect } from "@/components/shared/PeriodoSelect"
import { usePeriodoSeleccionado } from "@/hooks/usePeriodoSeleccionado"
import { useAuthStore } from "@/store/authStore"
import { useHorarioStore } from "@/store/horarioStore"
import { estudianteService } from "@/services/estudiante.service"
import { ApiError } from "@/services/api"
import { resolverArea } from "@/lib/curso-area"
import type { EstadoOferta } from "@/types/oferta"

const ESTADO_LABELS: Record<EstadoOferta, string> = {
  aprobado: "Aprobado",
  cursando: "Cursando",
  elegible: "Elegible",
  bloqueado: "Bloqueado",
}

// Elegible primero (lo único accionable sin filtrar nada) y bloqueado
// justo después (para saber qué falta); cursando/aprobado al final --
// ya están resueltos, no piden atención. Sin esto, la lista sale en
// orden alfabético de código y un estudiante tiene que bajar mucho o
// descubrir el filtro de estado para encontrar qué puede matricular.
const PRIORIDAD_ESTADO: Record<EstadoOferta, number> = {
  elegible: 0,
  bloqueado: 1,
  cursando: 2,
  aprobado: 3,
}

export function MisCursosPage() {
  const estudiante = useAuthStore((s) => s.estudiante)
  const queryClient = useQueryClient()

  const setPeriodoHorario = useHorarioStore((s) => s.setPeriodo)
  const cargarSeccionesFijas = useHorarioStore((s) => s.cargarSeccionesFijas)
  const seccionesManuales = useHorarioStore((s) => s.seccionesManuales)
  const limpiarSeccionesManuales = useHorarioStore((s) => s.limpiarSeccionesManuales)

  const {
    periodo,
    isLoading: isLoadingPeriodos,
    error: errorPeriodos,
  } = usePeriodoSeleccionado()
  const codigoPeriodo = periodo?.codigo

  // Primero el período, después las fijas: el store de horario descarta
  // el borrador/fijas del ciclo anterior antes de cargar los del nuevo.
  // Este efecto va ANTES del de las fijas a propósito (mismo commit de
  // React = se ejecutan en orden de declaración).
  useEffect(() => {
    if (codigoPeriodo) setPeriodoHorario(codigoPeriodo)
  }, [codigoPeriodo, setPeriodoHorario])

  const { data, isLoading, error } = useQuery({
    queryKey: ["oferta-ciclo", estudiante?.carnet, codigoPeriodo],
    queryFn: () => estudianteService.obtenerOferta(estudiante!.carnet, codigoPeriodo!),
    enabled: !!estudiante && !!codigoPeriodo,
  })

  // Los cursos "cursando" DE ESTE PERÍODO (ya matriculados, o recién
  // confirmados desde esta misma pantalla) se cargan como secciones fijas
  // del horario -- no son una elección editable acá. Un curso cursando en
  // otro ciclo aparece igual en la lista, pero su sección es de ese otro
  // ciclo y no entra a este calendario.
  useEffect(() => {
    if (!data || !codigoPeriodo) return
    const nrcsCursando = data
      .filter(
        (c) =>
          c.estado === "cursando" &&
          c.seccionActual &&
          c.periodoCursando?.codigo === codigoPeriodo
      )
      .map((c) => c.seccionActual!.nrc)
    cargarSeccionesFijas(nrcsCursando)
    // cargarSeccionesFijas es estable (Zustand); solo debe repetirse
    // cuando cambian los datos de la oferta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const errorCarga = error ?? errorPeriodos

  // Prefijo sin período: matricular o quitar un curso cambia su estado
  // ("Cursando") en la oferta de TODOS los ciclos, no solo en este.
  const invalidarOferta = () =>
    queryClient.invalidateQueries({ queryKey: ["oferta-ciclo", estudiante?.carnet] })

  // Tras confirmar, el mini-calendario se reemplaza por el CTA "Ver mi
  // horario" -- el estudiante decide cuándo navegar, sin redirect
  // automático. Se apaga solo si vuelve a armar un borrador nuevo
  // (seccionesManuales > 0 otra vez): no hace falta un efecto aparte,
  // la condición de render ya lo cubre (ver más abajo).
  // Guarda el período en que se confirmó, no un boolean: al cambiar de
  // ciclo el CTA no debe quedar mostrándose para un ciclo sin matrícula.
  const [matriculaConfirmadaEn, setMatriculaConfirmadaEn] = useState<string | null>(null)
  const matriculaRecienConfirmada = matriculaConfirmadaEn !== null && matriculaConfirmadaEn === codigoPeriodo

  // <xl (tablet/mobile): "Cursos" y "Horario" son tabs, una a la vez.
  // ≥xl: ambas se fuerzan visibles como paneles simultáneos (ver
  // TabsContent con forceMount + xl:data-[state=inactive]:block más
  // abajo) -- tabActiva solo importa por debajo de xl.
  const [tabActiva, setTabActiva] = useState<"cursos" | "horario">("cursos")

  const confirmarMatriculaMutation = useMutation({
    mutationFn: ({ nrcs, periodo }: { nrcs: string[]; periodo: string }) =>
      estudianteService.confirmarMatricula(estudiante!.carnet, nrcs, periodo),
    onSuccess: (_resultado, { periodo }) => {
      // El borrador ya quedó escrito en la BD como "cursando" -- se
      // limpia el borrador local para que no se cuente dos veces (una
      // vez como manual, otra como fija) cuando refetch traiga los
      // mismos cursos ya con estado "cursando".
      limpiarSeccionesManuales()
      invalidarOferta()
      setMatriculaConfirmadaEn(periodo)
      // Cambio de tab, no navegación de ruta -- no choca con "sin
      // redirect automático" (ese principio es sobre cruzar a /horario,
      // ver el Link "Ver mi horario" más abajo, que sigue intacto). Es
      // solo mostrar el resultado en la misma página sin que el
      // estudiante tenga que buscar la tab a mano. No tiene efecto
      // visual en ≥xl (ambos paneles ya están siempre visibles ahí).
      setTabActiva("horario")
    },
  })

  const quitarConfirmadoMutation = useMutation({
    mutationFn: (codigoCurso: string) =>
      estudianteService.quitarDelHistorial(estudiante!.carnet, codigoCurso),
    onSuccess: invalidarOferta,
  })

  const [busqueda, setBusqueda] = useState("")
  const [filtroEstado, setFiltroEstado] = useState<"todos" | EstadoOferta>("todos")
  const [filtroArea, setFiltroArea] = useState("todas")

  // Tope de 4 Estudios Generales (aprobado/cursando en BD + los que el
  // estudiante ya agregó al borrador local pero no ha confirmado
  // todavía) -- deshabilita "Agregar sección" en la card de un general
  // nuevo antes de que el estudiante intente matricularlo, en vez de
  // dejar que el error llegue recién al confirmar (el backend igual lo
  // vuelve a validar en confirmarMatricula, esto es solo UX).
  const limiteGeneralesAlcanzado = useMemo(() => {
    if (!data) return false
    const generalesConfirmados = data.filter(
      (c) => c.esGeneral && (c.estado === "aprobado" || c.estado === "cursando")
    ).length
    const codigosGenerales = new Set(data.filter((c) => c.esGeneral).map((c) => c.codigo))
    const generalesEnBorrador = seccionesManuales.filter((s) =>
      codigosGenerales.has(s.codigoCurso)
    ).length
    return generalesConfirmados + generalesEnBorrador >= 4
  }, [data, seccionesManuales])

  // Mismo criterio que limiteGeneralesAlcanzado, pero contra el tope de
  // optativas de la carrera del estudiante (dinámico, no siempre 4).
  const limiteOptativasAlcanzado = useMemo(() => {
    if (!data) return false
    const optativasConfirmadas = data.filter(
      (c) => c.esOptativa && (c.estado === "aprobado" || c.estado === "cursando")
    ).length
    const codigosOptativas = new Set(data.filter((c) => c.esOptativa).map((c) => c.codigo))
    const optativasEnBorrador = seccionesManuales.filter((s) =>
      codigosOptativas.has(s.codigoCurso)
    ).length
    const maximoOptativas = data.find((c) => c.esOptativa)?.maximoOptativas ?? Infinity
    return optativasConfirmadas + optativasEnBorrador >= maximoOptativas
  }, [data, seccionesManuales])

  const areasDisponibles = useMemo(() => {
    if (!data) return []
    const areas = new Set(data.map((c) => resolverArea(c.codigo).label))
    return Array.from(areas).sort()
  }, [data])

  const cursosFiltrados = useMemo(() => {
    if (!data) return []
    const q = busqueda.trim().toLowerCase()
    return data
      .filter((c) => {
        if (filtroEstado !== "todos" && c.estado !== filtroEstado) return false
        if (filtroArea !== "todas" && resolverArea(c.codigo).label !== filtroArea) return false
        if (q && !c.codigo.toLowerCase().includes(q) && !c.nombre.toLowerCase().includes(q)) {
          return false
        }
        return true
      })
      .sort((a, b) => {
        const porEstado = PRIORIDAD_ESTADO[a.estado] - PRIORIDAD_ESTADO[b.estado]
        return porEstado !== 0 ? porEstado : a.codigo.localeCompare(b.codigo)
      })
  }, [data, busqueda, filtroEstado, filtroArea])

  return (
    <>
      <Header
        title="Mis Cursos"
        description={
          estudiante
            ? `${estudiante.carrera.nombre} · oferta de ${periodo?.nombre ?? "…"}`
            : undefined
        }
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            disabled={
              !codigoPeriodo ||
              seccionesManuales.length === 0 ||
              confirmarMatriculaMutation.isPending
            }
            onClick={() =>
              confirmarMatriculaMutation.mutate({
                nrcs: seccionesManuales.map((s) => s.nrc),
                periodo: codigoPeriodo!,
              })
            }
          >
            <CheckCircle2 className="size-4" />
            {confirmarMatriculaMutation.isPending
              ? "Confirmando..."
              : `Confirmar Matrícula${
                  seccionesManuales.length > 0 ? ` (${seccionesManuales.length})` : ""
                }`}
          </Button>
        }
      />
      <main className="flex-1 p-4 md:p-6">
        {confirmarMatriculaMutation.isError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              {confirmarMatriculaMutation.error instanceof ApiError
                ? confirmarMatriculaMutation.error.message
                : "No se pudo confirmar la matrícula. Intenta de nuevo."}
            </AlertDescription>
          </Alert>
        )}

        {quitarConfirmadoMutation.isError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              {quitarConfirmadoMutation.error instanceof ApiError
                ? quitarConfirmadoMutation.error.message
                : "No se pudo quitar el curso. Intenta de nuevo."}
            </AlertDescription>
          </Alert>
        )}

        {/* Selector de ciclo arriba de todo: decide qué oferta, secciones y
            calendario se ven, en ambos paneles (por eso no vive dentro de
            la tab "Cursos"). En xl se alinea con el panel de la lista. */}
        <PeriodoSelect className="mb-4 xl:max-w-[560px]" />

        {/* <xl: "Cursos" y "Horario" son tabs (una a la vez, el layout de
            2 paneles simultáneos no entra cómodo por debajo de esto).
            ≥xl: mismo árbol de Tabs, pero ambos TabsContent se fuerzan
            visibles a la vez como paneles fijo + grande (forceMount +
            xl:data-[state=inactive]:block) -- un solo CalendarioSemanal
            en el DOM en cualquier breakpoint, no dos copias ocultas con
            CSS. TabsList (el selector de tabs) se oculta en xl porque ya
            no hace falta elegir, se ven las dos. */}
        <Tabs
          value={tabActiva}
          onValueChange={(v) => setTabActiva(v as "cursos" | "horario")}
          className="gap-4 xl:grid xl:grid-cols-[560px_1fr] xl:items-start"
        >
          <TabsList className="grid w-full grid-cols-2 xl:hidden">
            <TabsTrigger value="cursos">Cursos</TabsTrigger>
            <TabsTrigger value="horario">Horario</TabsTrigger>
          </TabsList>

          {/* Panel izquierdo: filtros + lista */}
          <TabsContent
            value="cursos"
            forceMount
            className="space-y-3 min-w-0 data-[state=inactive]:hidden xl:data-[state=inactive]:block"
          >
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por código o nombre..."
                  className="pl-8"
                  aria-label="Buscar curso"
                />
              </div>

              <div className="flex gap-2">
                <Select
                  value={filtroEstado}
                  onValueChange={(v) => setFiltroEstado(v as "todos" | EstadoOferta)}
                >
                  <SelectTrigger className="flex-1" aria-label="Filtrar por estado">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los estados</SelectItem>
                    {(Object.keys(ESTADO_LABELS) as EstadoOferta[]).map((estado) => (
                      <SelectItem key={estado} value={estado}>
                        {ESTADO_LABELS[estado]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filtroArea} onValueChange={setFiltroArea}>
                  <SelectTrigger className="flex-1" aria-label="Filtrar por área">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas las áreas</SelectItem>
                    {areasDisponibles.map((area) => (
                      <SelectItem key={area} value={area}>
                        {area}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {errorCarga && (
              <Alert variant="destructive">
                <AlertDescription>
                  {import.meta.env.DEV
                    ? errorCarga instanceof ApiError
                      ? `${errorCarga.status}: ${errorCarga.message}`
                      : "No se pudo conectar con la API. ¿Está corriendo en localhost:3000?"
                    : "No pudimos cargar la oferta de cursos. Intenta de nuevo más tarde."}
                </AlertDescription>
              </Alert>
            )}

            {(isLoading || isLoadingPeriodos) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...Array(6)].map((_, i) => (
                  <Card key={i}>
                    <CardContent className="p-3">
                      <Skeleton className="h-28 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Dos vacíos distintos: el ciclo no tiene oferta para la
                carrera (ej. Topografía en 2027, Banner no publicó nada
                todavía) vs. los filtros no dejan nada. */}
            {data && data.length === 0 && (
              <div className="py-8 text-center space-y-1">
                <p className="text-sm font-medium">
                  Todavía no hay oferta de {estudiante?.carrera.nombre} en {periodo?.nombre}
                </p>
                <p className="text-sm text-muted-foreground">
                  Banner no publicó secciones de tu carrera para este ciclo. Probá con otro
                  ciclo o volvé más adelante.
                </p>
              </div>
            )}

            {data && data.length > 0 && cursosFiltrados.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Ningún curso coincide con la búsqueda o los filtros.
              </p>
            )}

            {data && cursosFiltrados.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {cursosFiltrados.map((curso) => (
                  <CursoOfertaCard
                    key={curso.codigo}
                    curso={curso}
                    onQuitarConfirmado={(codigo) => quitarConfirmadoMutation.mutate(codigo)}
                    quitandoConfirmado={
                      quitarConfirmadoMutation.isPending &&
                      quitarConfirmadoMutation.variables === curso.codigo
                    }
                    limiteGeneralesAlcanzado={limiteGeneralesAlcanzado}
                    limiteOptativasAlcanzado={limiteOptativasAlcanzado}
                    periodoSeleccionado={codigoPeriodo!}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Panel derecho: calendario, fijo y grande -- o, recién
              confirmada la matrícula, el CTA a Mi Horario en su lugar
              (sin redirect automático a esa ruta, el estudiante hace
              click cuando quiera -- el cambio de tab de arriba es aparte,
              es solo mostrar este panel, no navegar). Vuelve a mostrar
              el calendario apenas arma un borrador nuevo
              (seccionesManuales > 0 otra vez). xl:sticky/xl:top-20 solo
              importa en el layout de 2 paneles (≥xl); por debajo de eso
              es una tab normal, sin necesidad de quedarse pegada. */}
          <TabsContent
            value="horario"
            forceMount
            className="min-w-0 data-[state=inactive]:hidden xl:data-[state=inactive]:block xl:sticky xl:top-20"
          >
            {matriculaRecienConfirmada && seccionesManuales.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                  <CheckCircle2 className="size-10 text-success" />
                  <div className="space-y-1">
                    <p className="font-semibold">Matrícula confirmada</p>
                    <p className="text-sm text-muted-foreground">
                      Tus cursos ya quedaron registrados como "Cursando".
                    </p>
                  </div>
                  <Link
                    to="/horario"
                    className="text-sm font-medium text-primary flex items-center gap-1 hover:underline"
                  >
                    Ver mi horario <ChevronRight className="size-4" />
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <CalendarioSemanal />
            )}
          </TabsContent>
        </Tabs>
      </main>
    </>
  )
}

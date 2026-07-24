import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Loader2 } from "lucide-react"
import { estudianteService } from "@/services/estudiante.service"
import { ApiError } from "@/services/api"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Alert, AlertDescription } from "@/components/ui/alert"

const OTRO = "__otro__"

interface AsignarCursoRealSheetProps {
  carnet: string
  /** null = cerrado. Código del slot GEN{n}/OPT{n} sobre el que se hizo click. */
  slotCodigo: string | null
  onOpenChange: (open: boolean) => void
}

export function AsignarCursoRealSheet({
  carnet,
  slotCodigo,
  onOpenChange,
}: AsignarCursoRealSheetProps) {
  const open = slotCodigo !== null
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ["malla-slot-opciones", carnet, slotCodigo],
    queryFn: () => estudianteService.obtenerOpcionesSlot(carnet, slotCodigo!),
    enabled: open,
  })

  const [seleccion, setSeleccion] = useState<string>("")
  const [nombreOtro, setNombreOtro] = useState("")

  // Preselecciona la opción actual (si el slot ya tenía una asignación)
  // cada vez que cambian los datos cargados, no en cada render.
  useEffect(() => {
    if (data?.estado === "disponible") {
      setSeleccion(data.seleccionActual ?? "")
      setNombreOtro("")
    }
  }, [data])

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["malla-progreso", carnet] })
    queryClient.invalidateQueries({ queryKey: ["malla-slot-opciones", carnet, slotCodigo] })
  }

  const asignarMutation = useMutation({
    mutationFn: () => {
      if (seleccion === OTRO) {
        return estudianteService.asignarCursoRealASlot(carnet, slotCodigo!, {
          cursoRealNombre: nombreOtro.trim(),
        })
      }
      return estudianteService.asignarCursoRealASlot(carnet, slotCodigo!, {
        cursoRealCodigo: seleccion,
      })
    },
    onSuccess: () => {
      invalidar()
      onOpenChange(false)
    },
  })

  const esSeleccionValida =
    seleccion !== "" && (seleccion !== OTRO || nombreOtro.trim().length > 0)

  const tipoLabel = data?.tipo === "OPT" ? "optativo" : "de Estudios Generales"
  const tipoLabelPlural = data?.tipo === "OPT" ? "optativas" : "Estudios Generales"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col overflow-y-auto">
        {isLoading && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="p-4">
            <Alert variant="destructive">
              <AlertDescription>
                {error instanceof ApiError
                  ? error.message
                  : "No se pudieron cargar las opciones. Intenta de nuevo."}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {data?.estado === "tope_alcanzado" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <CheckCircle2 className="size-10 text-success" />
            <SheetTitle>Ya completaste tus {tipoLabelPlural}</SheetTitle>
            <p className="text-sm text-muted-foreground">
              Ya tenés {data.maximo} de {data.maximo} {tipoLabelPlural} registradas.
            </p>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </div>
        )}

        {data?.estado === "disponible" && (
          <>
            <SheetHeader>
              <SheetTitle>¿Cuál curso {tipoLabel} aprobaste?</SheetTitle>
            </SheetHeader>

            {asignarMutation.isError && (
              <div className="px-4">
                <Alert variant="destructive">
                  <AlertDescription>
                    {asignarMutation.error instanceof ApiError
                      ? asignarMutation.error.message
                      : "No se pudo guardar. Intenta de nuevo."}
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <RadioGroup value={seleccion} onValueChange={setSeleccion} className="flex-1 px-4">
              {data.opciones.map((c) => (
                <Label
                  key={c.codigo}
                  htmlFor={c.codigo}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 has-[[data-state=checked]]:border-success has-[[data-state=checked]]:bg-success-bg/40"
                >
                  <RadioGroupItem value={c.codigo} id={c.codigo} />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{c.nombre}</p>
                    <p className="text-xs font-mono text-muted-foreground">
                      {c.codigo} · {c.creditos} créditos
                    </p>
                  </div>
                </Label>
              ))}

              <Label
                htmlFor={OTRO}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 has-[[data-state=checked]]:border-success has-[[data-state=checked]]:bg-success-bg/40"
              >
                <RadioGroupItem value={OTRO} id={OTRO} />
                <span className="text-sm">Otro curso (no está en la lista)</span>
              </Label>
            </RadioGroup>

            {seleccion === OTRO && (
              <div className="space-y-1.5 px-4">
                <Label htmlFor="nombreOtro">Nombre del curso</Label>
                <Input
                  id="nombreOtro"
                  value={nombreOtro}
                  onChange={(e) => setNombreOtro(e.target.value)}
                  placeholder="Ej. Historia del Arte"
                  autoFocus
                />
              </div>
            )}

            <SheetFooter className="flex-row justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                disabled={!esSeleccionValida || asignarMutation.isPending}
                onClick={() => asignarMutation.mutate()}
              >
                {asignarMutation.isPending && <Loader2 className="animate-spin" />}
                Confirmar
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

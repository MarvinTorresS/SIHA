/**
 * Área/color de acento por curso, derivado del prefijo del código
 * (ej. "EIF200" -> "EIF"). Puramente visual -- no reemplaza ni compite
 * con los colores de estado (aprobado/cursando/pendiente/sin_seccion).
 *
 * Centralizado aquí porque se usa en Dashboard, Malla Curricular, y
 * eventualmente Mi Horario (Sprint 7) -- un mismo curso debe verse con
 * el mismo color en cualquier pantalla donde aparezca.
 */

export interface AreaConfig {
  label: string
  borderClassName: string
  badgeClassName: string
}

const AREA_CONFIG: Record<string, AreaConfig> = {
  MAT: {
    label: "Matemática",
    borderClassName: "border-t-area-matematica",
    badgeClassName: "bg-area-matematica-bg text-area-matematica",
  },
  EIF: {
    label: "Informática",
    borderClassName: "border-t-area-informatica",
    badgeClassName: "bg-area-informatica-bg text-area-informatica",
  },
  LIX: {
    label: "Inglés",
    borderClassName: "border-t-area-ingles",
    badgeClassName: "bg-area-ingles-bg text-area-ingles",
  },
  GEN: {
    label: "Estudios generales",
    borderClassName: "border-t-area-generales",
    badgeClassName: "bg-area-generales-bg text-area-generales",
  },
  OPT: {
    label: "Optativa",
    borderClassName: "border-t-area-optativa",
    badgeClassName: "bg-area-optativa-bg text-area-optativa",
  },
}

const AREA_DEFAULT: AreaConfig = {
  label: "General",
  borderClassName: "border-t-area-general",
  badgeClassName: "bg-area-general-bg text-area-general",
}

/** Resuelve el área visual de un curso a partir de su código (ej. "EIF200"). */
export function resolverArea(codigo: string): AreaConfig {
  const match = codigo.match(/^[A-Za-z]+/)
  const prefijo = match?.[0]?.toUpperCase()
  if (prefijo && AREA_CONFIG[prefijo]) return AREA_CONFIG[prefijo]
  return AREA_DEFAULT
}

/**
 * Códigos GEN/OPT vienen namespaced por carrera en la BD (ej. "GEN1_ISI",
 * "OPT1_ISI") porque curso.codigo es UNIQUE y el mismo placeholder se
 * repite entre carreras -- ver excel_loader.py. Ese sufijo es un detalle
 * de modelado, no algo que el estudiante deba ver: en pantalla estos son
 * slots genéricos ("Estudios Generales I", "Optativa"), no cursos con
 * identidad propia por carrera.
 */
export function codigoVisible(codigo: string): string {
  return codigo.replace(/^(GEN|OPT)(\d+)_[A-Z]+$/, "$1$2")
}
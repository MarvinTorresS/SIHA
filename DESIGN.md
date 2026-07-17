---
name: SIHA
description: Sistema institucional de horarios y avance curricular para estudiantes de Campus Coto (UNA)
colors:
  una-rojo: "#EA0029"
  una-azul: "#001489"
  una-gris: "#A7A8AA"
  background: "#FFFFFF"
  foreground: "#0A0A0A"
  card: "#FFFFFF"
  muted: "#F4F4F5"
  muted-foreground: "#71717A"
  destructive: "#B91C1C"
  warning: "#D97706"
  warning-bg: "#FEF3C7"
  success: "#15803D"
  success-bg: "#DCFCE7"
  border: "#E4E4E7"
  sidebar: "#FAFAFA"
  estado-cursando: "#2563EB"
  estado-sin-seccion: "#7C3AED"
  area-matematica: "#6366F1"
  area-informatica: "#10B981"
  area-ingles: "#EC4899"
  area-generales: "#F97316"
  area-optativa: "#8B5CF6"
typography:
  display:
    fontFamily: "Sora, Segoe UI, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Sora, Segoe UI, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Sora, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Sora, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Sora, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  code:
    fontFamily: "Fira Code, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.02em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.una-rojo}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.una-rojo}"
  button-secondary:
    backgroundColor: "{colors.una-azul}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  badge-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  badge-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  card-default:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
    padding: "16px"
---

# Design System: SIHA

## 1. Overview

**Creative North Star: "El Tablero de Control del Registrador"**

SIHA se comporta como el tablero de un registrador universitario meticuloso, no como el mostrador de trámites que reemplaza. Cada pantalla existe para que un estudiante de Campus Coto responda, sin ambigüedad, dos preguntas: *¿mi horario tiene choques?* y *¿dónde estoy parado en mi carrera?* La superficie es institucional (rojo, azul y gris de la UNA), pero la ejecución es la de una herramienta de datos moderna: jerarquía tipográfica clara, estado codificado por color con disciplina semántica, y cero decoración que no cargue información.

El sistema rechaza explícitamente dos extremos. No es el formulario burocrático denso de un sistema universitario legado — tipografía diminuta, sin jerarquía, todo con el mismo peso visual. Tampoco es un dashboard SaaS genérico e intercambiable — nada de Inter, nada de degradados morado-a-azul, nada de tarjetas anidadas dentro de tarjetas, nada de texto gris flotando sobre fondos de color. El rojo institucional es la firma de marca, nunca la señal de error; ese rol es exclusivo del ámbar, y solo para choques de horario.

**Key Characteristics:**
- Rojo UNA como firma de marca y acento de acción primaria; nunca como estado de error o conflicto.
- Ámbar reservado en exclusiva para choques de horario en Mi Horario — ninguna otra situación lo usa.
- Cuatro estados de curso (aprobado, cursando, pendiente, sin_seccion) con un color dedicado cada uno, consistente en cualquier pantalla.
- Sora como única familia tipográfica, apoyada por Fira Code para códigos de curso — sin mezclar una segunda sans-serif genérica.
- Tarjetas planas con borde sutil y sombra mínima; la jerarquía se construye con tipografía y color, no con elevación.

## 2. Colors

La paleta institucional de la UNA gobierna marca y navegación; una paleta semántica independiente gobierna el estado de cada curso, para que un estudiante nunca confunda "esto es mío" con "esto necesita mi atención".

### Primary
- **Rojo UNA** (#EA0029): marca, navegación activa, acento del CTA principal, anillo de foco. Reservado exclusivamente para identidad de marca y acción — nunca para error o conflicto de horario.

### Secondary
- **Azul UNA** (#001489): soporte visual, estados informativos neutros, y la badge del estado "Pendiente" (un curso aún no cursado no es un error, es información neutra).

### Tertiary
- **Gris UNA** (#A7A8AA): neutro de transición institucional — fondos sutiles, hover states, bordes que necesitan más presencia que un gris genérico de sistema.

### Neutral
- **Blanco** (#FFFFFF): fondo base, superficie de tarjeta.
- **Casi negro** (#0A0A0A): texto principal.
- **Gris niebla** (#F4F4F5): fondos muted, skeletons, superficies secundarias.
- **Gris ceniza** (#71717A): texto secundario / metadata (créditos, subtítulos).
- **Borde neutro** (#E4E4E7): bordes de tarjeta, inputs, separadores.
- **Gris sidebar** (#FAFAFA): fondo de la barra lateral, un paso más claro que el fondo general para separar navegación de contenido.

### Estado de curso (paleta semántica, independiente de marca)
- **Aprobado — Verde** (#15803D sobre #DCFCE7): curso completado. Único estado que usa la pareja success/success-bg.
- **Cursando — Azul dato** (#2563EB): curso matriculado en el ciclo activo. Distinto del Azul UNA de marca para no leerse como "estado neutro institucional".
- **Pendiente — Azul UNA** (#001489 con texto blanco): curso aún no cursado; usa el azul de marca porque es, literalmente, un estado neutro de "todavía no".
- **Sin sección — Violeta** (#7C3AED): curso matriculado sin sección asignada este ciclo. Existe *precisamente* para no competir con el ámbar de conflicto.
- **Conflicto de horario — Ámbar** (#D97706 sobre #FEF3C7): exclusivo de Mi Horario. Ningún otro estado de curso puede usar este color.

### Área académica (acento decorativo, no de estado)
- **Matemática** (#6366F1 índigo) · **Informática** (#10B981 esmeralda) · **Inglés** (#EC4899 rosa) · **Estudios generales** (#F97316 naranja) · **Optativa** (#8B5CF6 violeta) — franja superior de 4px y badge pequeño en cada tarjeta de curso. Puramente informativo sobre el área del curso; nunca sustituye ni se confunde con el color de estado.

### Named Rules
**La Regla de Exclusividad del Ámbar.** El ámbar (`--warning`) se usa únicamente para choques de horario en Mi Horario. Ninguna otra alerta, error de sistema o estado de curso puede tomarlo prestado — por eso "sin sección" usa violeta y no ámbar.

**La Regla de Marca-No-Es-Error.** El rojo institucional nunca representa error, conflicto o estado negativo. Los errores de sistema (fallas de red, etc.) usan `--destructive` (#B91C1C), un rojo distinto y más oscuro, para que un estudiante nunca confunda un elemento de marca con una alerta real.

## 3. Typography

**Display/Body/Label Font:** Sora (con Segoe UI, system-ui, sans-serif como fallback)
**Code Font:** Fira Code (con ui-monospace, monospace como fallback)

**Character:** Una sola familia geométrica-humanista para todo el texto de interfaz — nada de mezclar una segunda sans "parecida pero no igual". Fira Code aparece solo donde el dato es literal e identificador (códigos de curso, NRC): la ruptura tipográfica señala "esto es un código, no prosa".

### Hierarchy
- **Display** (extrabold 800, 2.25rem/36px, line-height 1, tracking -0.02em): el número grande de porcentaje de avance en la malla. Uso muy restringido — un único número por pantalla como máximo.
- **Headline** (semibold 600, 1.125rem/18px): título de página en el Header (ej. "Malla Curricular").
- **Title** (semibold 600, 0.875rem/14px): títulos de tarjeta (CardTitle), nombre del curso dentro de su tarjeta.
- **Body** (regular/medium, 0.875rem/14px, line-height 1.5): texto general, descripciones, listas de metadata.
- **Label** (medium 500, 0.75rem/12px): subtítulos, sublabels de stat cards, texto de badge. Algunas instancias usan mayúsculas con tracking-wide como encabezado de sección de tarjeta (ej. "AVANCE EN LA MALLA") — mantener ese uso puntual, no generalizarlo a un kicker repetido sobre cada sección.
- **Code** (semibold 600, 0.75rem/12px, tracking 0.02em, Fira Code): código de curso (ej. "EIF200"), NRC de sección.

### Named Rules
**La Regla de Familia Única.** Toda la interfaz usa Sora. No se introduce una segunda sans-serif "parecida" (ni Inter, ni ninguna otra geométrica genérica) en ningún componente nuevo.

## 4. Elevation

SIHA es mayormente plano: la profundidad viene de bordes de 1px y una sombra mínima (`shadow-sm`) bajo las tarjetas, no de capas lifted ni glassmorphism. Los estados interactivos (hover en botones, accordion triggers) cambian de color de fondo, no de elevación.

### Shadow Vocabulary
- **Superficie base** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`, equivalente a `shadow-sm`): bajo cada `Card`. Uso constante, no reservado para hover.
- **Control interactivo** (`shadow-xs`): bajo botones y badges en su variante `default`, apenas perceptible — comunica "esto es una superficie", no "esto flota".

### Named Rules
**La Regla de Plano-por-Defecto.** Las superficies son planas en reposo. La sombra existe para separar tarjeta de fondo, no para simular elevación dramática; nunca se usa blur grande ni glassmorphism decorativo.

## 5. Components

### Buttons
- **Shape:** radio medio (8px, `rounded-md`), consistente en todos los tamaños.
- **Primary:** fondo Rojo UNA, texto blanco, `shadow-xs`, hover a rojo/90% de opacidad. Reservado para la acción principal de cada pantalla.
- **Secondary:** fondo Azul UNA, texto blanco — soporte visual, nunca compite con el primario en la misma vista.
- **Outline / Ghost:** fondo transparente o `background`, borde sutil, hover a gris UNA de fondo. Uso por defecto para acciones secundarias (navegar, cerrar).
- **Hover / Focus:** transición de color (no de tamaño ni sombra); anillo de foco en Rojo UNA a 50% de opacidad, 3px.

### Badges
- **Style:** radio pequeño (6px), texto 12px, sin borde cuando el color de fondo ya comunica el estado (`border-transparent`).
- **Variantes semánticas:** `warning` (ámbar/warning-bg), `success` (verde/success-bg), además de las variantes shadcn estándar (`default`, `secondary`, `destructive`, `outline`). Cada variante de estado de curso construye su clase directamente desde los tokens de color (ver sección 2), no reutiliza `destructive` para nada relacionado con horario.

### Cards / Containers
- **Corner Style:** radio grande (10px, `rounded-xl`).
- **Background:** blanco (`--card`), plano.
- **Shadow Strategy:** `shadow-sm` constante (ver Elevation).
- **Border:** 1px, `--border` (#E4E4E7); las tarjetas de curso añaden una franja superior de 4px (`border-t-4`) con el color de área académica — es la única franja de color permitida, y va arriba, nunca al costado.
- **Internal Padding:** 12–16px según densidad del contenido (`p-3` a `p-4` en tarjetas de curso, `px-6 py-6` en tarjetas de layout general).

### Estado Badge (componente de firma)
Combina ícono + etiqueta + color semántico para los cuatro estados de curso (aprobado/cursando/pendiente/sin_seccion). Es el componente que más carga semántica lleva en toda la app — su vocabulario de color (sección 2) debe respetarse exactamente igual en Dashboard, Malla y, cuando se construya, Mi Horario.

### Accordion
- **Style:** usado para agrupar cursos por ciclo/semestre. Trigger con fondo `muted/40` en reposo, `muted/60` en hover, sin subrayado. Todos los ciclos abiertos por defecto — el estudiante ve todo su plan de una vez, no navega ciclo por ciclo.

### Alert
- **Style:** fondo de tarjeta, sin relleno de color a menos que sea `destructive` (texto rojo-error, no rojo-marca). Usado hoy solo para errores de conexión con la API.

### Progress
- **Style:** barra de 2.5 (10px) de alto, pista en `primary/20`, relleno en `primary` (Rojo UNA) — el avance de carrera es, deliberadamente, del color de marca.

### Navigation
- **Sidebar:** fijo en desktop (`md:`+), 256px de ancho, fondo `--sidebar` (#FAFAFA) un tono más claro que el contenido. En mobile se convierte en drawer (`Sheet`) desde la izquierda, activado por el botón de menú del Header.
- **Header:** sticky, `z-30`, fondo `--background`, borde inferior sutil. Título + descripción contextual por página (ej. "ISI · I Ciclo 2026").

## 6. Do's and Don'ts

### Do:
- **Do** usar Sora como única familia sans en toda la interfaz; Fira Code solo para códigos de curso y NRC.
- **Do** mantener el ámbar exclusivo para choques de horario — ningún otro estado, alerta o badge lo reutiliza.
- **Do** mantener el rojo institucional fuera de cualquier estado de error o conflicto; los errores de sistema usan `--destructive` (#B91C1C), un rojo distinto.
- **Do** usar la franja superior de 4px (`border-t-4`) como único acento de color permitido en una tarjeta de curso, nunca lateral.
- **Do** promover `estado-cursando` (#2563EB) y `estado-sin-seccion` (#7C3AED) — hoy definidos ad hoc con clases de Tailwind (`blue-500`, `violet-500`) — a custom properties centralizadas junto a `--success` y `--warning`, para poder controlar su contraste en modo oscuro desde un solo lugar.
- **Do** construir el modo oscuro como una capa `.dark` sobre estos mismos tokens semánticos, preservando qué color significa qué estado; es un requisito de accesibilidad confirmado (WCAG AA) y aún no existe en el código (no hay variante `.dark` ni proveedor de tema).

### Don't:
- **Don't** usar tipografía Inter ni ninguna sans-serif genérica "parecida" a Sora.
- **Don't** usar degradados morado-a-azul en ningún elemento, decorativo o de texto.
- **Don't** anidar tarjetas dentro de tarjetas.
- **Don't** poner texto gris sobre fondos de color — el texto de estado usa siempre la pareja de contraste ya definida (ej. `--success` sobre `--success-bg`), nunca gris genérico.
- **Don't** usar `border-left` o `border-right` de color como acento — la única franja de color permitida es la superior de las tarjetas de curso.
- **Don't** repetir el patrón de ícono en tile redondeado sobre cada encabezado de sección como reflejo por defecto. Existe hoy en los `StatCard` del Dashboard y en los headers de las tarjetas de Malla (`size-8`/`size-9 rounded-lg` con ícono) — es exactamente el patrón que PRODUCT.md marca como cliché de SaaS genérico. Nuevas pantallas no deben repetirlo automáticamente; revisarlo en una pasada de `/impeccable polish` es la vía recomendada, no reescribirlo pantalla por pantalla sin criterio.
- **Don't** dar por hecho que el historial académico mostrado está sincronizado con el registro oficial — cualquier pantalla que lo muestre debe dejar claro que es información auto-reportada por el estudiante, no un dato verificado.

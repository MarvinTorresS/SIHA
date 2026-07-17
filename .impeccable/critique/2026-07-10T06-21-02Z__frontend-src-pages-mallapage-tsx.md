---
target: MallaPage.tsx
total_score: 20
p0_count: 0
p1_count: 2
timestamp: 2026-07-10T06-21-02Z
slug: frontend-src-pages-mallapage-tsx
---
Method: dual-agent (A: a289dfe5a6b13ffac · B: a011f77930c97eb45)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading skeleton doesn't preview the real two-card+accordion layout — layout jump on data arrival |
| 2 | Match System / Real World | 3 | Plain Spanish throughout, but never signals that "Aprobado"/"Cursando" is self-reported, not university-verified |
| 3 | User Control and Freedom | 2 | No "collapse all" / jump-to-current-cycle control |
| 4 | Consistency and Standards | 2 | `EstadoBadge`/`ESTADO_CONFIG` is local to this file; DashboardPage renders the same "estado" concept with a different pattern entirely |
| 5 | Error Prevention | 2 | Unguarded division (`creditosAprobados / creditosTotalesCarrera`) can produce `NaN%` |
| 6 | Recognition Rather Than Recall | 3 | Icon+label consistently paired, but "Sin sección" has no inline explanation of what it means |
| 7 | Flexibility and Efficiency | 1 | No search/filter/sort across a curriculum that can span 40+ courses / ~10 cycles |
| 8 | Aesthetic and Minimalist Design | 3 | Clean and token-driven, docked for the area/estado violet collision |
| 9 | Error Recovery | 1 | Error copy leaks dev details (`${error.status}: ${error.message}`, "¿Está corriendo en localhost:3000?") straight to students |
| 10 | Help and Documentation | 0 | Zero contextual help anywhere — no explainer for "sin_seccion," no note on data provenance |
| **Total** | | **20/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

**LLM assessment**: Not immediately recognizable as AI slop. The icon-tile pattern is genuinely gone (confirmed post-polish), the top-stripe-only color accent is followed correctly, and the single-Display-number restriction is respected. One residual tell: `AccordionItem` is styled as a card look-alike (`rounded-lg border border-border bg-card px-4`) wrapping real `<Card>` elements inside — visually a card-in-a-card even though it's semantically an accordion, which is the exact silhouette DESIGN.md's "no nested cards" rule targets.

**Deterministic scan**: `node .claude/skills/impeccable/scripts/detect.mjs --json frontend/src/pages/MallaPage.tsx` — exit code 2, one finding: `design-system-font-size` (advisory) at line 103, `text-[10px]` on the area `Badge`, off the documented type ramp. No false positives — this codebase otherwise uses `text-xs`/`text-sm` tokens throughout, so the arbitrary value is genuine drift. This is a case where the detector caught something the design review missed; folded into Priority Issues below as P3.

**Visual overlays**: Not available. No browser automation tool is exposed in this session, so there's no live-page overlay to point you to — this critique is source-level only. If you want the rendered visual confirmed, `npm run dev` in `frontend/` and eyeballing `/malla` is the fastest path, or hand it to the `run` skill.

## Overall Impression

The page is honestly executed against its own design system — the recent polish pass genuinely fixed what it set out to fix, and the restraint around Display typography and the top-stripe color rule is real discipline, not luck. The gap isn't visual polish, it's trust and scale: the page never admits its data is self-reported (exactly the thing PRODUCT.md says the whole app exists to be honest about), error states regress into raw dev output at the worst possible moment, and a full multi-year curriculum has no way to narrow focus beyond scrolling. The biggest single opportunity is closing the self-reported-data gap — it's a one-line fix that directly serves the app's own stated purpose.

## What's Working

- **All-semesters-open accordion matches the documented intent exactly** — implements DESIGN.md's "el estudiante ve todo su plan de una vez" rule precisely as written.
- **`EstadoBadge` pairs icon + label for every status, never relying on color alone** — a real accessibility win, and it's what keeps the violet collision (below) from being worse than it is.
- **Restrained Display typography**: exactly one `text-4xl font-extrabold` number on the whole page, matching DESIGN.md's "uso muy restringido" rule to the letter.

## Priority Issues

**[P1] Missing self-reported-data disclaimer**
- **What**: Nowhere on the page does it say "Aprobado/Cursando/Pendiente" reflects the student's self-entered historial, not a university-verified record.
- **Why it matters**: DESIGN.md's Don'ts state explicitly that any screen showing this data "debe dejar claro que es información auto-reportada." This is precisely that screen, and it's silent — for a student making a matrícula decision off this page, that silence reads as false reassurance.
- **Fix**: Add a persistent, low-key note near "Avance en la malla" (e.g. a small muted line under the `CardDescription`) — "Basado en tu historial registrado, no sincronizado con el sistema oficial."
- **Suggested command**: `/impeccable clarify`

**[P1] Developer-facing error messages shown to students**
- **What**: The error state renders `${error.status}: ${error.message}`, and the connection-failure fallback literally reads "¿Está corriendo en localhost:3000?"
- **Why it matters**: When this fires, the whole page is blocked (no `progreso` renders), so the only thing a student sees is a debug string — during the exact high-stakes moment PRODUCT.md warns about.
- **Fix**: Plain-language student copy + retry action ("No pudimos cargar tu avance. Intenta de nuevo."); gate the localhost hint behind `import.meta.env.DEV`.
- **Suggested command**: `/impeccable clarify`

**[P2] `EstadoBadge` isn't actually shared, despite being named the app's signature component**
- **What**: `ESTADO_CONFIG`/`EstadoBadge` are defined locally in `MallaPage.tsx` and never exported. `DashboardPage`'s `CursoMatriculadoCard` represents the identical "estado" concept with a completely different visual treatment (inline icon + text row for sin_seccion, no badge at all for cursando).
- **Why it matters**: DESIGN.md calls this "el componente que más carga semántica lleva en toda la app" and requires it to render identically in Dashboard, Malla, and eventually Mi Horario. Right now it isn't shared at all — Sprint 7's Mi Horario would become a third divergent implementation if this ships as-is.
- **Fix**: Extract `EstadoBadge`/`ESTADO_CONFIG` into `components/`, import into both pages.
- **Suggested command**: `/impeccable distill`

**[P2] Area color and estado color collide on violet**
- **What**: The "Optativa" area badge (`curso-area.ts`, `bg-violet-500/10 text-violet-600`) and the "sin_seccion" estado badge (`bg-violet-500/15 text-violet-600`) are near-identical violet. A course that's both Optativa and sin_seccion shows two barely-distinguishable violet badges side by side.
- **Why it matters**: DESIGN.md states area color must "nunca sustituye ni se confunde con el color de estado" — this is a direct, verifiable collision of that rule.
- **Fix**: Move "Optativa"'s area hue off violet (sin_seccion needs to keep it, per the amber-exclusivity-adjacent named rule).
- **Suggested command**: `/impeccable colorize`

**[P3] Arbitrary font size bypasses the type ramp**
- **What**: Line 103, `text-[10px]` on the area `Badge` — a literal value, not one of DESIGN.md's documented type tokens. Flagged by the deterministic detector, not visible in a read-through since it blends in next to otherwise-token-based `text-xs`/`text-sm` usage elsewhere in the same file.
- **Why it matters**: Small, but it's exactly the kind of one-off that compounds into drift if repeated — DESIGN.md's type hierarchy doesn't have a step this small, so it's an ad hoc value nobody chose deliberately.
- **Fix**: Either accept `text-[10px]` as a real "micro" step and add it to DESIGN.md's Typography hierarchy, or bump it to the nearest real token.
- **Suggested command**: `/impeccable typeset`

**[P3] Loading skeleton doesn't match the real layout**
- **What**: `isLoading` renders one generic `Skeleton` block inside a single `Card`, not the eventual two-card grid + accordion.
- **Why it matters**: Causes a layout jump when data arrives; `DashboardPage`'s own loading state does mirror its real grid, so this is also an internal inconsistency between sibling screens.
- **Fix**: Build two skeleton cards for the summary row plus 2-3 skeleton accordion rows.
- **Suggested command**: `/impeccable polish`

## Persona Red Flags

**Alex (Power User)**:
- No search or filter across the accordion — for a ~40-course, ~10-cycle curriculum, Alex must scroll and scan visually to find one course.
- No "collapse all" — every section opens by default, so narrowing to just the current cycle means manually collapsing every other section one at a time.
- The estado-count legend shows counts per state but isn't clickable/filterable — the affordance is visually implied ("click 'Pendiente' to filter") but doesn't exist.
- No quick way to jump to "Ciclo actual" beyond a small inline badge — no anchor scroll, no visual emphasis.

**Sam (Accessibility-dependent)**:
- `CardTitle` renders as a `<div>`, not a heading element — "Avance en la malla" and "Estado de cursos" are invisible to screen-reader heading navigation. The page's only real heading is the single `<h1>` in the shared `Header` component, so a screen-reader user gets one landmark and no way to jump section-to-section.
- No `.dark` theme exists anywhere in the CSS — a Sam using OS-level dark mode gets the fixed light palette regardless of preference, despite PRODUCT.md stating dark mode is "un requisito, no un extra."
- Translucent status colors (`bg-blue-500/15 text-blue-600`, `bg-violet-500/15 text-violet-600`) have contrast that depends on what's underneath the opacity layer — not independently verifiable as WCAG AA the way the flat `--success`/`--success-bg` pair is.

**Mariana — student mid-matrícula week** (project-specific, derived from PRODUCT.md's stated audience and stakes):
- No disclaimer that "Aprobado" is self-reported (see P1 above) — deciding what to register for next off a silently-unverified screen is precisely the failure mode PRODUCT.md names as costing "un cupo o un ciclo perdido."
- No forward link from Malla to Mi Horario — `DashboardPage` has a "Ver malla →" link, but `MallaPage` has no reciprocal CTA toward schedule-conflict checking, leaving Mariana to find her own way back to the sidebar mid-task.
- If the API errors during matrícula week, she sees "¿Está corriendo en localhost:3000?" — a confusing, broken-sounding message at the single worst moment for the brand's "confiable" promise to fail.

## Minor Observations

- `AccordionTrigger`'s actual implementation doesn't match DESIGN.md's own written spec ("fondo muted/40 en reposo, muted/60 en hover, sin subrayado") — the component as built has no muted background at rest and uses `hover:underline`. `MallaPage` is this component's primary consumer, so the drift is visible here first.
- The percentage/credit calculation duplicates `DashboardPage`'s identical logic verbatim rather than sharing a hook — a DRY risk if rounding ever diverges between the two screens showing the same number.
- "Estado de cursos" doesn't clarify scope in its title — it's a count across the entire career, not the current cycle, and nothing on first read signals which.
- Static cross-check (from Assessment B) came back otherwise clean: no inline styles, no console statements, no TODO/FIXME, no `any` usage, no raw hex colors, all `.map()` calls have explicit keys, no icon-only-without-label a11y gaps.

## Questions to Consider

- If "Aprobado" can't currently be distinguished from "verified by the university," is silence on that distinction really acceptable for a tool whose entire pitch is trustworthiness?
- With the whole curriculum expanded by default, is "see everything at once" actually serving the calm year-round-browsing moment, or does it just move the cognitive cost from clicking to scrolling? Would "current cycle open, rest collapsed with one-click expand-all" serve both of PRODUCT.md's stated moments better?
- `EstadoBadge` is named the app's signature component in DESIGN.md, yet lives only in this one file today. What does it cost to promote it to a shared primitive now, before Sprint 7's Mi Horario becomes a third divergent implementation of the same four states?

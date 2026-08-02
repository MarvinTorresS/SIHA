# MEMORY

Estado del proyecto y pendientes activos. Se actualiza a mano cuando cierra
un bloque de trabajo importante -- no es un changelog de cada commit, es un
"dónde quedamos" para retomar sin tener que reconstruir contexto.

## Sprint 8 -- cerrado

Verificado contra producción (Railway) el 01/ago/2026:

- Esquema V9 (`id_slot_malla`, `curso.verificado`) aplicado correctamente.
- No había filas legacy de Generales/Optativas sin `id_slot_malla` -- el
  borrado de las 4 cuentas de prueba que quedó pendiente en una sesión
  anterior ya no aplica (o se hizo, o la nota había quedado desactualizada).
- Las 27 electivas reales (`EIF*O`, `TDC*O`, `TGF*O`) con `ciclo_id`/
  `id_carrera` correctos en la tabla `curso`.
- Los placeholders `OPT{n}_{SIGLA}`/`GEN{n}_{SIGLA}` con `curso.id_carrera`
  en NULL es diseño esperado, no bug -- resuelven su carrera/ciclo vía
  `curso_carrera`, que es lo que `malla.service.ts` usa para armar la
  grilla. `curso.id_carrera` directo solo importa para el catálogo de
  electivas reales en `obtenerOpcionesParaSlot` (estudiante.service.ts).
- Cap de Generales/Optativas se calcula limpio, sin distorsión.

## Automatización del ETL -- construida, parcialmente probada

- `.github/workflows/etl.yml`: cron diario 12:00 UTC (6am CR), gratis
  (GitHub Actions, no Railway Cron que requiere plan pago).
- Guard en `config.py` (`debe_correr_etl`): corre solo si el mes actual está
  en `MESES_MATRICULA_ACTIVA = {1, 7, 11}` (enero/julio/noviembre -- no se
  conocen las fechas exactas de apertura por ciclo, así que se usa
  granularidad de mes en vez de día). El riesgo original que motivaba
  "nunca correr después de que abra matrícula" ya está mitigado desde
  Sprint 8 (`estado_oferta='agotada'` en vez de borrar), así que alcanza
  con acotar por mes.
- `run_etl.py`: entrypoint único (`banner_connector.run()` +
  `populate_db.run()`), con override `FORZAR_ETL=true` / input
  `forzar_guard` en el workflow para pruebas manuales fuera de ventana.
- **Probado:** corrida manual del guard en modo skip (agosto, fuera de
  ventana) -- exitosa, 9 segundos, sin tocar la BD.
- **NO probado todavía:** corrida forzada (`forzar_guard=true`) contra
  Railway de punta a punta con el guard desactivado.
- **Corregido (01/ago/2026):** el código de ciclo `"202620"` estaba
  hardcodeado en 3 lugares independientes (`config.CICLO_ACTIVO`,
  `banner_connector.TERM_CODE`, y el glob de
  `populate_db._insert_sections_from_banner`). Ahora los tres leen
  `CICLO_ACTIVO` de `config.py` -- antes, si se actualizaba uno y no los
  otros, el ETL automatizado corría a diario sin cargar nada, sin error
  visible.

## Datos reales de Banner completados a mano (01/ago/2026)

Los 5 `banner_<carrera>_202620.json` en `data-extractor/output/raw/`
(gitignored, no versionados) se completaron comparando contra los PDFs
oficiales de SIPROCU (Registro, II-Ciclo-2026, carpeta `Cursos/` del repo).
Banner no había devuelto 46 secciones reales que sí existen en la
programación oficial:

- ISI: 16 → 29 (13 agregadas)
- ITECAD: 5 → 7 (2 agregadas)
- TOPO: 10 → 14 (4 agregadas)
- Inglés: 16 → 23 (7 agregadas)
- Administración: 17 → 37 (20 agregadas)

Las agregadas llevan `capacity/enrolled/available = 0/0/0` (el PDF de
SIPROCU no trae cupos) y `metadata.fuente = "SIPROCU_pdf_manual"` para que
quede rastreable. Quedan como `estado_oferta='activa'` (no `agotada`,
porque agregarlas al JSON solo puede resultar en activa) -- en el frontend
se ven como "0/0 cupos", que comunica lo mismo visualmente pero sin el
badge específico de agotada. Probado en local (Docker) contra el frontend,
confirmado por Marvin que se ve bien.

**Pendiente relacionado:** existe `data-extractor/simulate_incidente_agotada.py`
(no está en el repo, se generó en sesión pero no se guardó ahí todavía),
que prueba específicamente el comportamiento de `estado_oferta='agotada'`
con los 28 NRC reales de ISI (usa un fixture separado, no toca los JSON
reales). No se llegó a correr -- Marvin se desvió a completar los JSON
reales en su lugar.

## Pendientes activos, en orden sugerido

1. Correr la prueba forzada del ETL (`forzar_guard=true`) contra Railway,
   ahora que la lógica ya se validó con datos reales en local.
2. Decidir si vale la pena correr `simulate_incidente_agotada.py` además,
   o si la validación manual con los PDFs ya cubrió lo importante.
3. Ideas nuevas de Marvin -- mencionadas al inicio de la sesión del
   01/ago/2026 pero nunca detalladas explícitamente (la automatización del
   ETL terminó siendo la idea que se desarrolló). Preguntarle si hay algo
   más que tenía en mente.
4. Menor / sin apuro: advertencia de Node.js 20 deprecado en las GitHub
   Actions (`actions/checkout@v4`, `actions/setup-python@v5`) -- actualizar
   a versiones más nuevas en algún momento.
5. Menor / sin apuro: `.claude/skills/find-skills` es un symlink roto
   (I/O error al leerlo) -- revisar o reinstalar el skill.

## Notas operativas de esta sesión

- El working directory del repo (montado desde Windows) no permite
  `unlink`/`rename` de archivos existentes en ciertos casos -- afecta a
  `git` (deja `.git/index.lock`/`.git/HEAD.lock` huérfanos, hay que
  renombrarlos con `mv` antes de cada operación de escritura) y a
  `git checkout --`. La forma segura de revertir un archivo a HEAD sin
  pasar por unlink es `git show HEAD:archivo > archivo` (trunca y
  reescribe, no borra).
- Sin acceso de red saliente a Railway/GitHub desde el entorno de
  ejecución -- las verificaciones SQL y el `git push` los corre Marvin
  directamente y pega los resultados de vuelta.

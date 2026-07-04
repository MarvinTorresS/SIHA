-- =============================================================
-- Validación Sprint 3 — Poblamiento PostgreSQL
-- Ejecutar con: psql -h localhost -p 5432 -U horarios -d sistema_horarios -f validar_sprint3.sql
-- =============================================================

\echo '=== 1. CONTEOS GENERALES ==='
SELECT 'carrera' AS tabla, count(*) AS filas FROM carrera
UNION ALL SELECT 'periodo', count(*) FROM periodo
UNION ALL SELECT 'curso', count(*) FROM curso
UNION ALL SELECT 'prerrequisito', count(*) FROM prerrequisito
UNION ALL SELECT 'seccion', count(*) FROM seccion
UNION ALL SELECT 'profesor', count(*) FROM profesor
UNION ALL SELECT 'horario_bloque', count(*) FROM horario_bloque;

\echo ''
\echo '=== 2. TASA DE JOIN Banner <-> Malla (debe ser >= 95%) ==='
SELECT
    count(*) AS total_secciones,
    count(*) FILTER (WHERE id_curso IS NOT NULL) AS matcheadas,
    count(*) FILTER (WHERE id_curso IS NULL) AS huerfanas,
    round(100.0 * count(*) FILTER (WHERE id_curso IS NOT NULL) / NULLIF(count(*), 0), 2) AS tasa_join_pct
FROM seccion;

\echo ''
\echo '=== 3. DETALLE DE HUÉRFANAS (si las hay) ==='
SELECT nrc, codigo_curso_banner, titulo, campus, creditos_min, creditos_max
FROM seccion
WHERE id_curso IS NULL
ORDER BY codigo_curso_banner
LIMIT 50;

\echo ''
\echo '=== 4. INTEGRIDAD REFERENCIAL: secciones con id_curso apuntando a curso inexistente ==='
-- Esto NO debería devolver filas si el FK está bien definido; es un doble-check
SELECT s.id_seccion, s.codigo_curso_banner, s.id_curso
FROM seccion s
LEFT JOIN curso c ON s.id_curso = c.id_curso
WHERE s.id_curso IS NOT NULL AND c.id_curso IS NULL;

\echo ''
\echo '=== 5. RESOLUCIÓN DE CRÉDITOS EN 0 (ej. EIF200 debía pasar de 0 a un valor real) ==='
SELECT codigo, nombre, creditos_min, creditos_max, creditos_fuente
FROM curso
WHERE codigo = 'EIF200';

\echo ''
\echo '--- Cuántos cursos quedaron todavía en 0 créditos tras el merge ---'
SELECT count(*) AS cursos_creditos_cero
FROM curso
WHERE creditos_max = 0;

\echo ''
\echo '--- Cursos en 0 créditos que SÍ tienen secciones en Banner con créditos > 0 (deberían haberse resuelto) ---'
SELECT c.codigo, c.nombre, c.creditos_max AS creditos_curso, s.creditos_max AS creditos_banner, s.nrc
FROM curso c
JOIN seccion s ON c.codigo = s.codigo_curso_banner
WHERE c.creditos_max = 0 AND s.creditos_max > 0;

\echo ''
\echo '=== 6. CURSOS GENERALES INSERTADOS AUTOMÁTICAMENTE DESDE BANNER ==='
SELECT codigo, nombre, creditos_min, creditos_max, es_general, creditos_fuente, id_carrera
FROM curso
WHERE es_general = true
ORDER BY codigo;

\echo ''
\echo '--- Generales que deberían haberse EXCLUIDO (placeholders GEN1-GEN4 sin prefijo Banner) ---'
SELECT codigo, nombre
FROM curso
WHERE codigo IN ('GEN1', 'GEN2', 'GEN3', 'GEN4');

\echo ''
\echo '=== 7. PROFESORES: duplicados por nombre (ON CONFLICT debería haber evitado esto) ==='
SELECT nombre, count(*) AS veces
FROM profesor
GROUP BY nombre
HAVING count(*) > 1;

\echo ''
\echo '=== 8. HORARIO_BLOQUE: bloques huérfanos (sin sección válida) ==='
SELECT h.id_horario_bloque, h.id_seccion
FROM horario_bloque h
LEFT JOIN seccion s ON h.id_seccion = s.id_seccion
WHERE s.id_seccion IS NULL;

\echo ''
\echo '--- Secciones con horarios (deberían ser la mayoría, salvo asincrónicas) ---'
SELECT
    count(DISTINCT s.id_seccion) AS secciones_totales,
    count(DISTINCT h.id_seccion) AS secciones_con_horario
FROM seccion s
LEFT JOIN horario_bloque h ON h.id_seccion = s.id_seccion;

\echo ''
\echo '=== 9. FECHAS: verificar que no quedaron NULL por mal parseo de MM/DD/YYYY ==='
SELECT count(*) AS secciones_sin_fecha_inicio
FROM seccion
WHERE fecha_inicio IS NULL;

SELECT nrc, codigo_curso_banner, fecha_inicio, fecha_fin
FROM seccion
WHERE fecha_inicio IS NULL OR fecha_fin IS NULL
LIMIT 20;

\echo ''
\echo '=== 10. CAMPUS: verificar que NO quedó el prefijo "SRB: " sin limpiar ==='
SELECT DISTINCT campus, count(*)
FROM seccion
GROUP BY campus;

\echo ''
\echo '=== 11. PRERREQUISITOS: referencias circulares simples (A requiere B y B requiere A) ==='
SELECT p1.id_curso, p1.id_curso_requerido
FROM prerrequisito p1
JOIN prerrequisito p2
  ON p1.id_curso = p2.id_curso_requerido
 AND p1.id_curso_requerido = p2.id_curso;

\echo ''
\echo '=== 12. CURSOS DE LA MALLA SIN NINGUNA SECCIÓN EN BANNER (posible curso no ofertado este ciclo) ==='
SELECT c.codigo, c.nombre
FROM curso c
LEFT JOIN seccion s ON s.id_curso = c.id_curso
WHERE c.es_general = false
  AND s.id_seccion IS NULL
ORDER BY c.codigo
LIMIT 50;

\echo ''
\echo '=== FIN DE VALIDACIÓN ==='

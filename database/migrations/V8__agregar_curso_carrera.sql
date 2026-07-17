-- V8__agregar_curso_carrera.sql
-- Agrega la tabla `curso_carrera`, que resuelve un bug real de datos:
-- `curso.codigo` es UNIQUE globalmente y `curso.id_carrera` es una sola
-- FK, así que un curso solo podía pertenecer a UNA carrera. Pero varios
-- cursos de servicio (inglés, matemática básica) se repiten en distintas
-- carreras, cada una tomándolos en un ciclo distinto -- ej. LIX410
-- "Inglés Integrado I" está en el ciclo "1 1" de ISI e ITECAD, pero en
-- "2 1" de TOPO. El loader (populate_db.py) deduplicaba por código y
-- solo la primera carrera en aparecer en el Excel se quedaba con el
-- curso; las demás lo perdían en silencio de su malla.
--
-- curso_carrera es la tabla puente: un curso (identidad única, la que
-- matchea secciones de Banner vía codigo_curso_banner) puede tener varias
-- filas, una por cada carrera que lo requiere, cada una con su propio
-- ciclo_id/ciclo_nombre. Los créditos y es_optativo NO varían entre
-- carreras en los datos reales (confirmado contra syllabi_normalized.json),
-- así que esos dos campos se quedan en `curso`.
--
-- curso.id_carrera/ciclo_id/ciclo_nombre quedan sin usarse para cursos
-- de malla a partir de ahora (el loader deja de escribirlos); se
-- mantienen en la tabla para no romper filas ya insertadas de cursos
-- generales de Banner (es_general=true, id_carrera NULL a propósito,
-- ver _insert_general_courses_from_banner en populate_db.py), que no
-- pertenecen a ninguna carrera y no necesitan curso_carrera.

CREATE TABLE curso_carrera (
    id_curso     INTEGER NOT NULL REFERENCES curso(id_curso) ON DELETE CASCADE,
    id_carrera   INTEGER NOT NULL REFERENCES carrera(id_carrera) ON DELETE CASCADE,
    ciclo_id     VARCHAR(10) NOT NULL DEFAULT '',
    ciclo_nombre VARCHAR(50) NOT NULL DEFAULT '',
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id_curso, id_carrera)
);

CREATE INDEX ix_curso_carrera_carrera ON curso_carrera(id_carrera);

-- Backfill desde las filas de `curso` que ya tienen id_carrera asignado
-- (una fila por curso, la carrera que "ganó" la deduplicación hasta
-- ahora). No es una migración de datos completa -- solo evita perder lo
-- que ya había mientras se vuelve a correr el loader (populate_db.py),
-- que es quien realmente repuebla las filas que faltaban.
INSERT INTO curso_carrera (id_curso, id_carrera, ciclo_id, ciclo_nombre)
SELECT id_curso, id_carrera, ciclo_id, ciclo_nombre
FROM curso
WHERE id_carrera IS NOT NULL
ON CONFLICT (id_curso, id_carrera) DO NOTHING;

COMMENT ON TABLE curso_carrera IS
    'Relación N:M entre curso y carrera -- un curso puede requerirse en '
    'varias mallas, cada una en un ciclo distinto (ej. cursos de servicio '
    'como inglés o matemática básica). curso.id_carrera/ciclo_id/ciclo_nombre '
    'quedan obsoletos para cursos de malla; ver V8__agregar_curso_carrera.sql.';

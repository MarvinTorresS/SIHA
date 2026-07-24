-- V9: soporte para "marcar aprobado con selector" en slots de Estudios
-- Generales y Optativas.
--
-- Antes, historial_curso.id_curso hacía doble uso: para generales, el
-- backend ya redirigía a idCursoDestino (el curso real), pero CUAL slot
-- GEN{n}/OPT{n} corresponde a esa fila se inferia por orden estable en
-- cada lectura (ver resolverCursoGeneralParaSlot), nunca se persistía.
-- id_slot_malla hace esa asociación explícita: id_curso queda SIEMPRE
-- como el curso real (Banner, malla o manual), id_slot_malla es opcional
-- y apunta al slot GEN{n}_{sigla}/OPT{n}_{sigla} que ese curso real llena.
--
-- verificado distingue cursos reales cargados desde una fuente confiable
-- (Banner/Excel, default true, no rompe filas existentes) de los creados
-- a mano por un estudiante vía la opción "Otro" (verificado=false).

ALTER TABLE curso ADD COLUMN IF NOT EXISTS verificado BOOLEAN NOT NULL DEFAULT true;

-- ck_curso_creditos_fuente solo permitía 'malla'/'banner' -- los cursos
-- creados vía la opción "Otro" del Sheet usan 'manual'.
ALTER TABLE curso DROP CONSTRAINT IF EXISTS ck_curso_creditos_fuente;
ALTER TABLE curso ADD CONSTRAINT ck_curso_creditos_fuente
  CHECK (creditos_fuente::text = ANY (ARRAY['malla', 'banner', 'manual']::text[]));

ALTER TABLE historial_curso ADD COLUMN IF NOT EXISTS id_slot_malla INTEGER NULL
  REFERENCES curso(id_curso);

CREATE INDEX IF NOT EXISTS ix_historial_slot_malla ON historial_curso (id_slot_malla);

-- Único parcial: un slot de malla no puede tener dos cursos reales
-- asignados al mismo estudiante a la vez. Parcial porque id_slot_malla
-- es NULL para el 100% de las filas de cursos normales (no placeholder).
CREATE UNIQUE INDEX IF NOT EXISTS uq_historial_slot_malla_estudiante
  ON historial_curso (id_estudiante, id_slot_malla)
  WHERE id_slot_malla IS NOT NULL;

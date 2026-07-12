-- V6__agregar_tipo_prerrequisito.sql
-- Agrega la columna `tipo` a `prerrequisito` para poder guardar
-- correquisitos en la misma tabla, en vez de crear una tabla nueva.
--
-- Hasta ahora `prerrequisito` solo modelaba relaciones curso -> curso de
-- tipo "hay que haber aprobado Y antes de llevar X" (ej. EIF201 requiere
-- EIF200). excel_loader.py ya produce un campo separado "correquisitos"
-- (cursos que se deben llevar EN SIMULTÁNEO, no antes -- ej. FIY423 y
-- FIY423L en Topografía) que hoy no se inserta en ningún lado.
--
-- La relación en sí es idéntica en forma (un par curso/curso_requerido),
-- así que reutilizamos la misma tabla en vez de duplicar la estructura;
-- lo único que cambia es la columna `tipo`, que el motor de
-- prerrequisitos (prerrequisito.service.ts) debe usar para filtrar --
-- un correquisito NUNCA debe evaluarse como "debe estar aprobado antes".
--
-- default 'prerequisito' para que las filas ya existentes (todas
-- prerrequisitos puntuales de la malla) no cambien de significado.
--
-- También se amplía el UNIQUE (id_curso, id_curso_requerido) a
-- (id_curso, id_curso_requerido, tipo): el original asumía que un par de
-- cursos tenía a lo sumo UNA relación. Con dos tipos en la misma tabla,
-- si el mismo par llegara a ser prerrequisito Y correquisito a la vez
-- (no se da hoy en la malla real, pero la constraint vieja lo prevendría
-- en silencio vía ON CONFLICT DO NOTHING al insertar el segundo), hay
-- que poder representarlo como dos filas distintas.

ALTER TABLE prerrequisito
    ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'prerequisito';

ALTER TABLE prerrequisito
    ADD CONSTRAINT ck_prerrequisito_tipo CHECK (tipo IN ('prerequisito', 'correquisito'));

ALTER TABLE prerrequisito
    DROP CONSTRAINT uq_prerrequisito;

ALTER TABLE prerrequisito
    ADD CONSTRAINT uq_prerrequisito UNIQUE (id_curso, id_curso_requerido, tipo);

COMMENT ON COLUMN prerrequisito.tipo IS
    '''prerequisito'' (default): id_curso_requerido debe estar aprobado antes de llevar id_curso. '
    '''correquisito'': id_curso_requerido se debe llevar en el mismo ciclo que id_curso, no antes. '
    'Todo lector de esta tabla que construya el árbol de "qué debo tener aprobado" '
    'DEBE filtrar por tipo = ''prerequisito'' -- ver prerrequisito.service.ts.';

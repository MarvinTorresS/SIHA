-- ============================================================================
-- V2__agregar_ciclo_y_optativo_curso.sql
-- Sistema de Planificación de Horarios Académicos — UNA Campus Coto
-- Sprint 3: agrega columnas de ciclo curricular y flag de optatividad
-- ============================================================================
--
-- Motivo: syllabi_normalized.json (la malla) trae ciclo_id, ciclo_nombre
-- y es_optativo por curso, y el pipeline de poblamiento (populate_db.py)
-- ya esperaba estas columnas en `curso`. La V1 no las incluía; esta
-- migración las agrega sin afectar los datos ya cargados.
-- ============================================================================

BEGIN;

ALTER TABLE curso
    ADD COLUMN ciclo_id     VARCHAR(10)  NOT NULL DEFAULT '',
    ADD COLUMN ciclo_nombre VARCHAR(50)  NOT NULL DEFAULT '',
    ADD COLUMN es_optativo  BOOLEAN      NOT NULL DEFAULT false;

COMMENT ON COLUMN curso.ciclo_id IS 'Identificador de ciclo en la malla, ej. "1", "2", "Opt"';
COMMENT ON COLUMN curso.ciclo_nombre IS 'Nombre descriptivo del ciclo, ej. "Ciclo Opt"';
COMMENT ON COLUMN curso.es_optativo IS 'true si el curso es una optativa dentro de la malla';

COMMIT;

-- ============================================================================
-- V3__agregar_metadata_seccion.sql
-- Sistema de Planificación de Horarios Académicos — UNA Campus Coto
-- Sprint 3: agrega columna metadata a seccion
-- ============================================================================
--
-- Motivo: populate_db.py guarda en `metadata` todos los campos crudos de
-- Banner que no tienen columna dedicada en `seccion` (ej. datos adicionales
-- de la searchResults JSON que no forman parte del modelo normalizado pero
-- se conservan para auditoría/debug futuro). Se usa JSONB para poder
-- indexar/consultar el contenido si hiciera falta más adelante.
-- ============================================================================

BEGIN;

ALTER TABLE seccion
    ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN seccion.metadata IS 'Campos crudos adicionales de Banner sin columna dedicada, para auditoría';

COMMIT;

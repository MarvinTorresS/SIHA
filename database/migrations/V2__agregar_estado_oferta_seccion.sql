-- ============================================================================
-- V2__agregar_estado_oferta_seccion.sql
-- Sprint 8 — retrofit del ETL de oferta: secciones que desaparecen de Banner
-- entre corridas ya no se borran, se marcan.
-- ============================================================================
--
-- Contexto (ver V1, nota de diseño #2 y el incidente de secciones
-- fantasma documentado en populate_db.py): hasta ahora, una sección que
-- dejaba de aparecer en el JSON de Banner de una corrida se borraba de
-- `seccion` con DELETE. Eso pierde el último cupo conocido y puede
-- romper referencias si algún día se agrega más historial dependiente
-- de `seccion` además de `historial_curso` (que ya tolera la pérdida
-- vía ON DELETE SET NULL, pero no debería depender de ese fallback).
--
-- `estado_oferta` reemplaza el DELETE por un marcador: 'activa' mientras
-- el NRC siga viniendo en el JSON de Banner, 'agotada' en cuanto deja de
-- aparecer. `capacidad`/`disponibles` NO se tocan al pasar a 'agotada':
-- quedan en el último valor real conocido en vez de perderse o resetearse
-- a 0/NULL.

BEGIN;

ALTER TABLE seccion
    ADD COLUMN estado_oferta VARCHAR(10) NOT NULL DEFAULT 'activa';

ALTER TABLE seccion
    ADD CONSTRAINT ck_seccion_estado_oferta
    CHECK (estado_oferta IN ('activa', 'agotada'));

COMMIT;

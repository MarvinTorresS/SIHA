-- V10: soporte multi-período.
--
-- periodo.activo pasa a significar "visible/seleccionable en SIHA" (puede
-- haber N activos a la vez, ver selector de ciclo en Mis Cursos/Mi Horario).
-- Lo administra el ETL con una regla explícita; un período nuevo NO debe
-- nacer activo por omisión, así que el default pasa a false.
--
-- Compatible con PostgreSQL 9.6 (producción, se aplica a mano en phpPgAdmin).

ALTER TABLE periodo ALTER COLUMN activo SET DEFAULT false;

-- Backfill: filas 'cursando' legacy sin período. Antes de este cambio solo
-- existía 202620 como período de matrícula, así que es el único posible.
-- No se resuelve en tiempo de ejecución con "el período por defecto" porque
-- ese default cambia con el tiempo y la fila saltaría de ciclo.
UPDATE historial_curso
SET id_periodo = (SELECT id_periodo FROM periodo WHERE codigo = '202620')
WHERE estado = 'cursando' AND id_periodo IS NULL;

-- V7__agregar_auth_estudiante.sql
-- Agrega autenticación real a `estudiante`, reemplazando el estudiante
-- mock que usaba el frontend hasta ahora.
--
-- password_hash: hash bcrypt de la contraseña, nunca la contraseña en
-- texto plano. Se agrega nullable primero porque ya existe una fila de
-- desarrollo (carnet 20260123, el ex-ESTUDIANTE_MOCK del frontend, con
-- 6 filas de historial_curso reales asociadas) que no tiene contraseña;
-- se le asigna una de prueba conocida para no perder ese historial, y
-- recién ahí se vuelve NOT NULL para todo registro futuro.

ALTER TABLE estudiante
    ADD COLUMN password_hash VARCHAR(100);

-- Contraseña de desarrollo para el estudiante semilla: "estudiante123"
-- (bcrypt, 10 rounds). Solo para este carnet fijo de pruebas locales.
UPDATE estudiante
    SET password_hash = '$2b$10$MMuPpswRWnIcxOP6.SEPLuX8TUK.cNPh6cnyPVGbLwlFFM.WyWkT2'
    WHERE carnet = '20260123';

ALTER TABLE estudiante
    ALTER COLUMN password_hash SET NOT NULL;

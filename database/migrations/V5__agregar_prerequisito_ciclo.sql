-- V5__agregar_prerequisito_ciclo.sql
-- Agrega prerequisito_ciclo: un segundo tipo de prerrequisito, distinto del
-- que ya modela la tabla `prerrequisito`.
--
-- `prerrequisito` es una relación curso -> curso puntual: "para llevar X hay
-- que haber aprobado Y". Eso alcanza para la mayoría de la malla, pero no
-- para casos como TGF425 y TGF426 (carrera TOPO), donde el requisito no es
-- una lista fija de cursos sino "haber completado TODOS los cursos de la
-- malla entre un ciclo de inicio y uno de fin" (ej. completar del ciclo
-- "1 1" al "3 2"). Ese conjunto de cursos es dinámico: si la malla cambia
-- (se agrega/quita un curso en esos ciclos), el requisito debe reflejarlo
-- automáticamente sin editar filas de prerrequisito una por una.
--
-- Por eso esta tabla no lista cursos individuales: guarda un rango de
-- ciclo_id (los mismos valores que ya usa curso.ciclo_id, ej. "1 1", "3 2")
-- y el motor de prerrequisitos es responsable de resolver ese rango contra
-- la malla vigente en tiempo de evaluación. La UNIQUE en id_curso asume que
-- un curso tiene a lo sumo un requisito de este tipo (no se combinan varios
-- rangos para el mismo curso).
--
-- NOTA: esta migración documenta la tabla ya creada manualmente en Docker
-- vía DBeaver. No modifica excel_loader.py, populate_db.py, ni el motor de
-- prerrequisitos — eso queda para una tarea posterior.

CREATE TABLE prerequisito_ciclo (
    id_prerequisito_ciclo SERIAL PRIMARY KEY,
    id_curso              INTEGER     NOT NULL REFERENCES curso (id_curso),
    ciclo_id_desde        VARCHAR(10) NOT NULL,
    ciclo_id_hasta        VARCHAR(10) NOT NULL,

    CONSTRAINT prerequisito_ciclo_id_curso_key UNIQUE (id_curso)
);

COMMENT ON TABLE prerequisito_ciclo IS
    'Prerrequisito de tipo "rango de ciclos": el curso id_curso requiere '
    'haber completado todos los cursos de la malla cuyo ciclo_id cae entre '
    'ciclo_id_desde y ciclo_id_hasta (inclusive). Distinto de `prerrequisito`, '
    'que exige cursos puntuales en vez de un rango dinámico.';
COMMENT ON COLUMN prerequisito_ciclo.ciclo_id_desde IS
    'Límite inferior del rango de ciclos requerido (formato igual a curso.ciclo_id, ej. "1 1").';
COMMENT ON COLUMN prerequisito_ciclo.ciclo_id_hasta IS
    'Límite superior del rango de ciclos requerido (formato igual a curso.ciclo_id, ej. "3 2").';

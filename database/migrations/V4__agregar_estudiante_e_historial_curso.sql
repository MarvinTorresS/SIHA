-- V4__agregar_estudiante_e_historial_curso.sql
-- Agrega el modelo de estudiante e historial académico personal.
-- Hasta ahora la BD solo modelaba el catálogo institucional (malla + oferta
-- Banner), sin ninguna relación a un estudiante particular. Esta migración
-- introduce esa capa: qué estudiante existe, qué carrera cursa, y el estado
-- de cada curso de su malla (aprobado / cursando / pendiente).
--
-- NOTA sobre nota: la columna existe pero NO se puebla ni se muestra en el
-- frontend por ahora. La fuente de notas (kardex/boleta de Banner) todavía
-- no está integrada al ETL. Se deja el campo listo para cuando exista esa
-- fuente, sin construir lógica de ponderado sobre datos que no tenemos.
--
-- NOTA sobre "sin_seccion": este estado NO se guarda en esta tabla. Se
-- calcula dinámicamente en el backend cuando un curso del ciclo_actual_id
-- del estudiante está en estado "pendiente" y no existe ninguna `seccion`
-- ofertada para ese curso en el `periodo` activo. Guardarlo como valor fijo
-- generaría inconsistencia apenas Banner publique la oferta.

CREATE TABLE estudiante (
    id_estudiante   SERIAL PRIMARY KEY,
    carnet          VARCHAR(20)  NOT NULL,
    nombre          VARCHAR(200) NOT NULL,
    correo          VARCHAR(150) NOT NULL,
    id_carrera      INTEGER      NOT NULL,
    ciclo_actual_id VARCHAR(10)  NOT NULL DEFAULT '',
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_estudiante_carnet UNIQUE (carnet),
    CONSTRAINT uq_estudiante_correo UNIQUE (correo),
    CONSTRAINT fk_estudiante_carrera
        FOREIGN KEY (id_carrera) REFERENCES carrera (id_carrera)
        ON DELETE RESTRICT ON UPDATE NO ACTION
);

COMMENT ON COLUMN estudiante.ciclo_actual_id IS
    'Ciclo actual real del estudiante (ej. "3 1"), usado para calcular el '
    'estado "sin_seccion" en el backend. No necesariamente coincide con el '
    'ciclo ideal de la malla si el estudiante adelantó o atrasó cursos.';

CREATE INDEX ix_estudiante_carrera ON estudiante (id_carrera);


CREATE TABLE historial_curso (
    id_historial   SERIAL PRIMARY KEY,
    id_estudiante  INTEGER      NOT NULL,
    id_curso       INTEGER      NOT NULL,
    estado         VARCHAR(20)  NOT NULL,
    nota           DECIMAL(4,1),
    id_seccion     INTEGER,
    id_periodo     INTEGER,
    creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_historial_estudiante_curso UNIQUE (id_estudiante, id_curso),
    CONSTRAINT ck_historial_estado
        CHECK (estado IN ('aprobado', 'cursando', 'pendiente')),
    CONSTRAINT fk_historial_estudiante
        FOREIGN KEY (id_estudiante) REFERENCES estudiante (id_estudiante)
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT fk_historial_curso
        FOREIGN KEY (id_curso) REFERENCES curso (id_curso)
        ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT fk_historial_seccion
        FOREIGN KEY (id_seccion) REFERENCES seccion (id_seccion)
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT fk_historial_periodo
        FOREIGN KEY (id_periodo) REFERENCES periodo (id_periodo)
        ON DELETE SET NULL ON UPDATE NO ACTION
);

COMMENT ON COLUMN historial_curso.estado IS
    'Solo tres valores persistidos: aprobado, cursando, pendiente. '
    'El valor "sin_seccion" mostrado en frontend es calculado, no persistido.';
COMMENT ON COLUMN historial_curso.nota IS
    'Placeholder para cuando se integre la fuente de notas (kardex/boleta '
    'Banner). No poblado ni usado en Sprint 6 — sin lógica de ponderado.';
COMMENT ON COLUMN historial_curso.id_seccion IS
    'Sección en la que el estudiante está matriculado, si estado = cursando. '
    'NULL si aprobado o pendiente.';

CREATE INDEX ix_historial_estudiante ON historial_curso (id_estudiante);
CREATE INDEX ix_historial_curso ON historial_curso (id_curso);
CREATE INDEX ix_historial_estado ON historial_curso (estado);
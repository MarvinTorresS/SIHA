-- ============================================================================
-- V1__schema_inicial.sql
-- Sistema de Planificación de Horarios Académicos — UNA Campus Coto
-- Esquema completo (3FN) para poblamiento PostgreSQL
-- ============================================================================
--
-- Consolidación: este archivo reemplaza a las V1-V8 originales (fusionadas
-- aquí en una sola migración porque el proyecto no usa una herramienta de
-- migraciones con historial versionado -- no hay flyway_schema_history ni
-- prisma/migrations; el esquema real se gestiona a mano (docker exec psql /
-- DBeaver) y `api/prisma/schema.prisma` se mantiene sincronizado vía
-- `prisma db pull`. El historial narrativo de CÓMO se llegó a este esquema
-- (qué bug motivó cada tabla/columna) queda en el historial de git de las
-- V1-V8 originales; este archivo documenta el ESTADO final, no el journey.
--
-- Notas de diseño relevantes que sobrevivieron el proceso:
--   1. seccion.nrc es el identificador real de Banner (ON CONFLICT DO UPDATE
--      para idempotencia de cargas).
--   2. seccion.id_curso es NULLABLE: permite insertar secciones de Banner
--      que no matchean con la malla (huérfanos), sin bloquear la carga.
--   3. aula vive en horario_bloque, no en seccion, porque teoría y
--      laboratorio pueden estar en aulas distintas.
--   4. curso.creditos es una sola columna NUMERIC (no creditos_min/max):
--      verificado que Campus Coto no reporta créditos en rango.
--   5. profesor se normaliza aparte (no se repite el nombre en cada sección).
--   6. curso_carrera resuelve que un mismo curso (ej. LIX410 "Inglés
--      Integrado I") puede requerirse en varias carreras, cada una en un
--      ciclo distinto -- curso.codigo es UNIQUE globalmente, así que la
--      identidad del curso vive en `curso` y su ubicación en cada malla
--      vive en `curso_carrera` (N:M). curso.id_carrera/ciclo_id/ciclo_nombre
--      quedan sin usarse para cursos de malla (se mantienen para los
--      cursos generales de Banner, es_general=true, que no pertenecen a
--      ninguna carrera y no necesitan curso_carrera).
--   7. prerrequisito modela DOS relaciones curso->curso en la misma tabla,
--      distinguidas por `tipo`: 'prerequisito' (debe estar aprobado antes)
--      y 'correquisito' (debe llevarse en simultáneo, no antes). Todo
--      lector que construya el árbol de "qué debo tener aprobado" DEBE
--      filtrar por tipo='prerequisito' (ver prerrequisito.service.ts).
--   8. prerrequisito.id_carrera resuelve un segundo bug de la misma familia
--      que curso_carrera: el Excel define prerrequisitos DISTINTOS para un
--      mismo curso compartido según la carrera (ej. MAT002 exige MAT030
--      solo en ISI, MAT001 solamente en TOPO/ITECAD). Sin este scope, el
--      loader insertaba la UNIÓN de ambos requisitos, y un estudiante de
--      TOPO terminaba con un prerrequisito de un curso que ni siquiera
--      existe en su malla. NULL = aplica a cualquier carrera donde el
--      curso exista (uso reservado; el loader de la malla siempre setea
--      un valor concreto porque cada fila del Excel pertenece a una
--      carrera).
--   9. prerequisito_ciclo modela un tercer tipo de requisito, no listado en
--      `prerrequisito`: "haber completado TODOS los cursos de la malla
--      entre un ciclo de inicio y uno de fin" (ej. TGF425/TGF426 en TOPO).
--      Es un rango dinámico (se resuelve contra la malla vigente en tiempo
--      de evaluación), no una lista fija de cursos.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- Catálogos base
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE carrera (
    id_carrera   SERIAL PRIMARY KEY,
    sigla        VARCHAR(10)  NOT NULL UNIQUE,   -- 'isi', 'itecad', 'topo'
    nombre       VARCHAR(150) NOT NULL,
    campus       VARCHAR(50)  NOT NULL DEFAULT 'Campus Coto',
    creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE periodo (
    id_periodo   SERIAL PRIMARY KEY,
    codigo       VARCHAR(10)  NOT NULL UNIQUE,   -- '202620'
    nombre       VARCHAR(50)  NOT NULL,           -- 'Ciclo II 2026'
    anio         SMALLINT     NOT NULL,
    ciclo        SMALLINT     NOT NULL,
    activo       BOOLEAN      NOT NULL DEFAULT true,
    creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_periodo_ciclo CHECK (ciclo BETWEEN 1 AND 3)
);

CREATE TABLE profesor (
    id_profesor  SERIAL PRIMARY KEY,
    nombre       VARCHAR(200) NOT NULL,
    correo       VARCHAR(150),
    creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_profesor_nombre UNIQUE (nombre)
);

-- ────────────────────────────────────────────────────────────────────────
-- Curso (malla curricular), su relación N:M con carrera, y prerrequisitos
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE curso (
    id_curso        SERIAL PRIMARY KEY,
    codigo          VARCHAR(20)  NOT NULL UNIQUE,  -- 'EIF207'
    nombre          VARCHAR(200) NOT NULL,
    creditos        NUMERIC(3,1) NOT NULL DEFAULT 0,
    -- Obsoletos para cursos de malla (ver curso_carrera); solo se usan
    -- para cursos generales de Banner (es_general=true, id_carrera NULL
    -- a propósito porque son compartidos entre carreras).
    id_carrera      INTEGER REFERENCES carrera(id_carrera) ON DELETE RESTRICT,
    ciclo_id        VARCHAR(10)  NOT NULL DEFAULT '',
    ciclo_nombre    VARCHAR(50)  NOT NULL DEFAULT '',
    es_optativo     BOOLEAN      NOT NULL DEFAULT false,
    es_general      BOOLEAN      NOT NULL DEFAULT false,  -- EGF/EGC/EGS/EGA
    creditos_fuente VARCHAR(20)  NOT NULL DEFAULT 'malla', -- 'malla' | 'banner'
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_curso_creditos_fuente CHECK (creditos_fuente IN ('malla', 'banner'))
);

CREATE INDEX ix_curso_carrera ON curso(id_carrera);
CREATE INDEX ix_curso_codigo ON curso(codigo);

COMMENT ON COLUMN curso.ciclo_id IS 'Obsoleto para cursos de malla (ver curso_carrera.ciclo_id); identificador de ciclo, ej. "1 1", "Opt"';
COMMENT ON COLUMN curso.ciclo_nombre IS 'Obsoleto para cursos de malla (ver curso_carrera.ciclo_nombre); nombre descriptivo del ciclo';
COMMENT ON COLUMN curso.es_optativo IS 'true si el curso es una optativa dentro de la malla';

CREATE TABLE curso_carrera (
    id_curso     INTEGER NOT NULL REFERENCES curso(id_curso) ON DELETE CASCADE,
    id_carrera   INTEGER NOT NULL REFERENCES carrera(id_carrera) ON DELETE CASCADE,
    ciclo_id     VARCHAR(10) NOT NULL DEFAULT '',
    ciclo_nombre VARCHAR(50) NOT NULL DEFAULT '',
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id_curso, id_carrera)
);

CREATE INDEX ix_curso_carrera_carrera ON curso_carrera(id_carrera);

COMMENT ON TABLE curso_carrera IS
    'Relación N:M entre curso y carrera -- un curso puede requerirse en '
    'varias mallas, cada una en un ciclo distinto (ej. cursos de servicio '
    'como inglés o matemática básica).';

CREATE TABLE prerrequisito (
    id_prerrequisito   SERIAL PRIMARY KEY,
    id_curso           INTEGER NOT NULL REFERENCES curso(id_curso) ON DELETE CASCADE,
    id_curso_requerido INTEGER NOT NULL REFERENCES curso(id_curso) ON DELETE CASCADE,
    tipo               VARCHAR(20) NOT NULL DEFAULT 'prerequisito',
    -- Carrera dueña de este requisito (ver nota de diseño #8 arriba).
    id_carrera         INTEGER REFERENCES carrera(id_carrera) ON DELETE CASCADE,

    CONSTRAINT uq_prerrequisito UNIQUE (id_curso, id_curso_requerido, tipo, id_carrera),
    CONSTRAINT ck_prerrequisito_no_autoreferencia CHECK (id_curso <> id_curso_requerido),
    CONSTRAINT ck_prerrequisito_tipo CHECK (tipo IN ('prerequisito', 'correquisito'))
);

CREATE INDEX ix_prerrequisito_curso ON prerrequisito(id_curso);
CREATE INDEX ix_prerrequisito_requerido ON prerrequisito(id_curso_requerido);
CREATE INDEX ix_prerrequisito_carrera ON prerrequisito(id_carrera);

COMMENT ON COLUMN prerrequisito.tipo IS
    '''prerequisito'' (default): id_curso_requerido debe estar aprobado antes de llevar id_curso. '
    '''correquisito'': id_curso_requerido se debe llevar en el mismo ciclo que id_curso, no antes. '
    'Todo lector de esta tabla que construya el árbol de "qué debo tener aprobado" '
    'DEBE filtrar por tipo = ''prerequisito'' -- ver prerrequisito.service.ts.';
COMMENT ON COLUMN prerrequisito.id_carrera IS
    'Carrera dueña de este requisito, según la hoja del Excel de origen. '
    'NULL = aplica a cualquier carrera donde el curso exista (uso futuro; '
    'el loader de la malla siempre setea un valor concreto porque cada fila '
    'del Excel pertenece a una carrera). Corrige el bug donde un curso '
    'compartido entre carreras (ej. MAT002) heredaba la UNION de los '
    'requisitos de todas las hojas del Excel en vez de solo los suyos.';

CREATE TABLE prerequisito_ciclo (
    id_prerequisito_ciclo SERIAL PRIMARY KEY,
    id_curso              INTEGER     NOT NULL REFERENCES curso(id_curso),
    ciclo_id_desde         VARCHAR(10) NOT NULL,
    ciclo_id_hasta         VARCHAR(10) NOT NULL,

    CONSTRAINT prerequisito_ciclo_id_curso_key UNIQUE (id_curso)
);

COMMENT ON TABLE prerequisito_ciclo IS
    'Prerrequisito de tipo "rango de ciclos": el curso id_curso requiere '
    'haber completado todos los cursos de la malla cuyo ciclo_id cae entre '
    'ciclo_id_desde y ciclo_id_hasta (inclusive). Distinto de `prerrequisito`, '
    'que exige cursos puntuales en vez de un rango dinámico.';
COMMENT ON COLUMN prerequisito_ciclo.ciclo_id_desde IS
    'Límite inferior del rango de ciclos requerido (formato igual a curso_carrera.ciclo_id, ej. "1 1").';
COMMENT ON COLUMN prerequisito_ciclo.ciclo_id_hasta IS
    'Límite superior del rango de ciclos requerido (formato igual a curso_carrera.ciclo_id, ej. "3 2").';

-- ────────────────────────────────────────────────────────────────────────
-- Sección (oferta real, viene de Banner) y bloques de horario
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE seccion (
    id_seccion      SERIAL PRIMARY KEY,
    nrc             VARCHAR(10)  NOT NULL,         -- courseReferenceNumber de Banner
    -- id_curso NULLABLE a propósito: permite cargar secciones de Banner
    -- que no matchean con la malla (huérfanos), sin bloquear el insert.
    id_curso        INTEGER REFERENCES curso(id_curso) ON DELETE SET NULL,
    codigo_curso_banner VARCHAR(20) NOT NULL,      -- código tal cual vino de Banner, ej 'EIF207'
    id_periodo      INTEGER NOT NULL REFERENCES periodo(id_periodo) ON DELETE RESTRICT,
    id_profesor     INTEGER REFERENCES profesor(id_profesor) ON DELETE SET NULL,
    numero_seccion  VARCHAR(10)  NOT NULL DEFAULT '',  -- sequenceNumber, ej '01'
    titulo          VARCHAR(200) NOT NULL DEFAULT '',
    tipo            VARCHAR(50)  NOT NULL DEFAULT '',  -- 'Teoría', 'Laboratorio', etc.
    campus          VARCHAR(50)  NOT NULL DEFAULT 'Campus Coto',
    creditos        NUMERIC(3,1) NOT NULL DEFAULT 0,
    capacidad       SMALLINT     NOT NULL DEFAULT 0,
    inscritos       SMALLINT     NOT NULL DEFAULT 0,
    disponibles     SMALLINT     NOT NULL DEFAULT 0,
    es_general      BOOLEAN      NOT NULL DEFAULT false,
    fecha_inicio    DATE,
    fecha_fin       DATE,
    -- Campos crudos adicionales de Banner sin columna dedicada, para auditoría.
    metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_seccion_nrc_periodo UNIQUE (nrc, id_periodo),
    CONSTRAINT ck_seccion_cupos CHECK (inscritos <= capacidad OR capacidad = 0)
);

CREATE INDEX ix_seccion_curso ON seccion(id_curso);
CREATE INDEX ix_seccion_periodo ON seccion(id_periodo);
CREATE INDEX ix_seccion_profesor ON seccion(id_profesor);
CREATE INDEX ix_seccion_codigo_banner ON seccion(codigo_curso_banner);
-- Acelera el reporte de huérfanos (secciones sin match en malla)
CREATE INDEX ix_seccion_huerfanas ON seccion(id_periodo) WHERE id_curso IS NULL;

CREATE TABLE horario_bloque (
    id_horario_bloque SERIAL PRIMARY KEY,
    id_seccion        INTEGER NOT NULL REFERENCES seccion(id_seccion) ON DELETE CASCADE,
    dia               VARCHAR(15) NOT NULL,   -- 'Lunes', 'Martes', ...
    hora_inicio       TIME        NOT NULL,
    hora_fin          TIME        NOT NULL,
    aula              VARCHAR(50) NOT NULL DEFAULT '',  -- 'IC-301'

    CONSTRAINT uq_horario_bloque UNIQUE (id_seccion, dia, hora_inicio, hora_fin),
    CONSTRAINT ck_horario_bloque_horas CHECK (hora_inicio < hora_fin),
    CONSTRAINT ck_horario_bloque_dia CHECK (
        dia IN ('Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo')
    )
);

CREATE INDEX ix_horario_bloque_seccion ON horario_bloque(id_seccion);
-- Acelera el ConflictDetector: buscar choques por día
CREATE INDEX ix_horario_bloque_dia_horas ON horario_bloque(dia, hora_inicio, hora_fin);

-- ────────────────────────────────────────────────────────────────────────
-- Estudiante e historial académico personal
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE estudiante (
    id_estudiante   SERIAL PRIMARY KEY,
    carnet          VARCHAR(20)  NOT NULL,
    nombre          VARCHAR(200) NOT NULL,
    correo          VARCHAR(150) NOT NULL,
    id_carrera      INTEGER      NOT NULL,
    ciclo_actual_id VARCHAR(10)  NOT NULL DEFAULT '',
    -- Hash bcrypt de la contraseña, nunca la contraseña en texto plano.
    password_hash   VARCHAR(100) NOT NULL,
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
    'Banner). No poblado ni usado por ahora -- sin lógica de ponderado.';
COMMENT ON COLUMN historial_curso.id_seccion IS
    'Sección en la que el estudiante está matriculado, si estado = cursando. '
    'NULL si aprobado o pendiente.';

CREATE INDEX ix_historial_estudiante ON historial_curso (id_estudiante);
CREATE INDEX ix_historial_curso ON historial_curso (id_curso);
CREATE INDEX ix_historial_estado ON historial_curso (estado);

COMMIT;

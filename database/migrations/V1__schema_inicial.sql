-- ============================================================================
-- V1__schema_inicial.sql
-- Sistema de Planificación de Horarios Académicos — UNA Campus Coto
-- Sprint 3: Esquema normalizado (3FN) para poblamiento PostgreSQL
-- ============================================================================
--
-- Notas de diseño respecto al modelo conceptual original:
--   1. seccion incluye nrc (identificador real de Banner, usado para
--      ON CONFLICT DO UPDATE / idempotencia de cargas).
--   2. seccion.curso_id es NULLABLE: permite insertar secciones de Banner
--      que no hicieron match con un curso de la malla (huérfanos), sin
--      bloquear la carga. Se resuelven después con el reporte de huérfanos.
--   3. aula vive en horario_bloque, no en seccion, porque teoría y
--      laboratorio pueden estar en aulas distintas (ya verificado en ETL).
--   4. curso.creditos es una sola columna NUMERIC: se verificó contra los
--      datos reales de Campus Coto (isi, itecad, topo) que ningún curso ni
--      sección reporta créditos en rango (ej. "1-3"); todos son valores
--      exactos. Se simplificó de creditos_min/creditos_max a una sola
--      columna. Si en un futuro ciclo aparece un curso con créditos
--      variables, se deberá revisar este diseño.
--   5. profesor se normaliza aparte (no se repite el nombre en cada sección).
--   6. periodo y carrera son catálogos pequeños, separados para integridad
--      referencial y para soportar múltiples ciclos/carreras a futuro.
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
-- Curso (malla curricular) y prerrequisitos
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE curso (
    id_curso       SERIAL PRIMARY KEY,
    codigo         VARCHAR(20)  NOT NULL UNIQUE,  -- 'EIF207'
    nombre         VARCHAR(200) NOT NULL,
    creditos       NUMERIC(3,1) NOT NULL DEFAULT 0,
    id_carrera     INTEGER REFERENCES carrera(id_carrera) ON DELETE RESTRICT,
    es_general     BOOLEAN      NOT NULL DEFAULT false,  -- EGF/EGC/EGS/EGA
    creditos_fuente VARCHAR(20) NOT NULL DEFAULT 'malla', -- 'malla' | 'banner' (Sprint 3: resolver en 0)
    creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_curso_creditos_fuente CHECK (creditos_fuente IN ('malla', 'banner'))
);

CREATE INDEX ix_curso_carrera ON curso(id_carrera);
CREATE INDEX ix_curso_codigo ON curso(codigo);

CREATE TABLE prerrequisito (
    id_prerrequisito   SERIAL PRIMARY KEY,
    id_curso           INTEGER NOT NULL REFERENCES curso(id_curso) ON DELETE CASCADE,
    id_curso_requerido INTEGER NOT NULL REFERENCES curso(id_curso) ON DELETE CASCADE,

    CONSTRAINT uq_prerrequisito UNIQUE (id_curso, id_curso_requerido),
    CONSTRAINT ck_prerrequisito_no_autoreferencia CHECK (id_curso <> id_curso_requerido)
);

CREATE INDEX ix_prerrequisito_curso ON prerrequisito(id_curso);
CREATE INDEX ix_prerrequisito_requerido ON prerrequisito(id_curso_requerido);

-- ────────────────────────────────────────────────────────────────────────
-- Sección (oferta real, viene de Banner) y bloques de horario
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE seccion (
    id_seccion      SERIAL PRIMARY KEY,
    nrc             VARCHAR(10)  NOT NULL,         -- courseReferenceNumber de Banner
    -- curso_id NULLABLE a propósito: permite cargar secciones de Banner
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

    CONSTRAINT ck_horario_bloque_horas CHECK (hora_inicio < hora_fin),
    CONSTRAINT ck_horario_bloque_dia CHECK (
        dia IN ('Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo')
    )
);

CREATE INDEX ix_horario_bloque_seccion ON horario_bloque(id_seccion);
-- Acelera el ConflictDetector (Sprint 5): buscar choques por día
CREATE INDEX ix_horario_bloque_dia_horas ON horario_bloque(dia, hora_inicio, hora_fin);

COMMIT;
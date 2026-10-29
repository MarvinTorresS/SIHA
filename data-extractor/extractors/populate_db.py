# extractors/populate_db.py
"""
Pipeline de poblamiento PostgreSQL — Sprint 3
=============================================
Flujo (multi-período, orquestado por run_etl.py):
  A. Una vez por corrida -- load_catalog_and_syllabus():
     carreras, cursos de la malla, prerrequisitos, correquisitos y
     prerequisitos de rango de ciclos (syllabi_normalized.json).
  B. Por cada período, en su propia transacción -- load_term():
     periodo (nace activo=false), secciones + profesores + horarios desde
     Banner, marca 'agotada' por (período, carrera), cursos de generales
     y MERGE seccion.id_curso.
  C. Una vez al final -- apply_active_rule(): periodo.activo según la regla
     única de extractors/terms.decide_active.
  D. Reporte de calidad.

Ejecución standalone (sin pegarle a Banner, desde los banner_*.json ya
extraídos): python -m extractors.populate_db

Nota de diseño (créditos):
  Se verificó contra los datos reales de Campus Coto que ningún curso ni
  sección de Banner reporta créditos en rango (ej. "1-3"); todos son
  valores exactos. Por eso el schema y este pipeline usan una sola
  columna `creditos`, no creditos_min/creditos_max.

  Los créditos de curso vienen únicamente de PLANES_DE_ESTUDIO.xlsx
  (verificado manualmente) vía excel_loader.py -- no se corrigen con datos
  de Banner. Existió un paso _resolve_zero_credits_from_banner que hacía
  esa corrección cuando la malla venía de malla_scraper.py (créditos poco
  confiables); se eliminó porque el Excel ya es la fuente autoritativa.
  seccion.creditos sí puede diferir de curso.creditos (Banner reporta
  créditos por sección, curso.creditos es el de la malla) -- eso no
  cambia con esta decisión, solo se dejó de sobrescribir curso.creditos.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from datetime import date, datetime
from collections import defaultdict

import psycopg2
from psycopg2.extras import execute_values, RealDictCursor

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import (
    DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD,
    OUTPUT_NORMALIZED_DIR, OUTPUT_RAW_DIR, LOGS_DIR,
)
from extractors.terms import (
    PeriodState, TermStatus, decide_active, describe_term,
)

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOGS_DIR / "populate_db.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ── Conexión ──────────────────────────────────────────────────────────────────

def _connect():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _parse_credits(value) -> float:
    """
    Convierte el valor de créditos (int, str numérico) a float.
    Nota: se verificó que en los datos reales de Campus Coto no existen
    créditos en rango (ej. "1-3"); si algún ciclo futuro lo introduce,
    esta función debe revisarse (ver nota de diseño en el schema).
    """
    if value is None or value == "":
        return 0.0
    if isinstance(value, str) and "-" in value:
        # Defensivo: si algún día aparece un rango, tomamos el máximo
        # para no perder información, y lo dejamos loggeado.
        parts = value.split("-")
        log.warning(f"  ⚠ Valor de créditos en rango detectado: '{value}' — se toma el máximo")
        return float(parts[-1])
    return float(value)


# Formato EXPLÍCITO que manda Banner en meetingTime.startDate/endDate:
# MM/DD/YYYY (ej. "07/20/2026"). El parser anterior asumía DD/MM y fallaba
# en silencio: todas las fecha_inicio/fecha_fin quedaban NULL.
BANNER_DATE_FORMAT = "%m/%d/%Y"


def _parse_banner_date(value: str | None, nrc: str, field_name: str) -> date | None:
    """
    '07/20/2026' -> date(2026, 7, 20). Si viene vacía o no parsea, WARNING
    por sección y None -- nunca un NULL silencioso.
    """
    if not value:
        log.warning(f"  ⚠ NRC {nrc}: {field_name} vacía en Banner")
        return None
    try:
        return datetime.strptime(value.strip(), BANNER_DATE_FORMAT).date()
    except ValueError:
        log.warning(f"  ⚠ NRC {nrc}: {field_name} '{value}' no tiene formato MM/DD/YYYY")
        return None


def _parse_time(value: str) -> str | None:
    """'08:00 AM' → '08:00'. Retorna None si no es válida."""
    if not value:
        return None
    cleaned = value.replace(" AM", "").replace(" PM", "").replace(" a.m.", "").replace(" p.m.", "").strip()
    return cleaned or None


# ──────────────────────────────────────────────────────────────────────────────
# PASO 1: Catálogos
# ──────────────────────────────────────────────────────────────────────────────

def _insert_careers(conn) -> dict[str, int]:
    """Inserta las carreras desde CARRERAS_CAMPUS_COTO y retorna {sigla: id_carrera}."""
    from config import CARRERAS_CAMPUS_COTO

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO carrera (sigla, nombre)
            VALUES %s
            ON CONFLICT (sigla) DO UPDATE SET nombre = EXCLUDED.nombre
            RETURNING sigla, id_carrera
            """,
            [(sigla, nombre) for sigla, nombre in CARRERAS_CAMPUS_COTO.items()],
        )
        return {row[0]: row[1] for row in cur.fetchall()}


def _insert_term(conn, code: str) -> int:
    """
    Inserta o actualiza el periodo y retorna id_periodo. Año, ciclo y
    nombre salen de describe_term (sufijo desconocido = error explícito).
    Un período nuevo nace activo=false: solo apply_active_rule lo activa,
    con la regla única del ETL. En conflicto se actualiza el nombre, nunca
    activo (eso también es solo de apply_active_rule).
    """
    year, cycle, name = describe_term(code)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO periodo (codigo, nombre, anio, ciclo, activo)
            VALUES (%s, %s, %s, %s, false)
            ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre
            RETURNING id_periodo
            """,
            (code, name, year, cycle),
        )
        return cur.fetchone()[0]


# ──────────────────────────────────────────────────────────────────────────────
# PASO 2: Cursos desde la malla
# ──────────────────────────────────────────────────────────────────────────────

def _insert_courses_from_syllabus(conn, career_map: dict[str, int]) -> dict[str, int]:
    """
    Inserta cursos desde syllabi_normalized.json.
    Retorna {codigo: id_curso} para el MERGE posterior.

    Dos tablas distintas, dos granularidades:
    - `curso`: identidad única por código (matchea secciones de Banner vía
      codigo_curso_banner, y es lo que referencia historial_curso). Se
      deduplica por código -- créditos y es_optativo no varían entre
      carreras en los datos reales.
    - `curso_carrera`: UNA fila por cada aparición real (código, carrera)
      en el Excel, SIN deduplicar. Necesaria porque varios cursos de
      servicio (ej. LIX410 "Inglés Integrado I") se repiten en distintas
      carreras, cada una en un ciclo distinto -- deduplicar por código
      perdía silenciosamente el curso de todas las carreras menos la
      primera en aparecer (ver V8__agregar_curso_carrera.sql).
    """
    path = OUTPUT_NORMALIZED_DIR / "syllabi_normalized.json"
    with open(path, encoding="utf-8") as f:
        raw_courses = json.load(f)

    # Deduplicar por código para la identidad única en `curso`.
    seen = set()
    unique_courses = []
    for c in raw_courses:
        code = c["codigo"]
        if code in seen:
            continue
        seen.add(code)
        unique_courses.append(c)

    # Preparar tuplas para INSERT
    # Nota: GEN1_{SIGLA}..GEN4_{SIGLA} son placeholders genéricos de "Estudios
    # Generales" -- namespaced por carrera en excel_loader.py igual que OPT*,
    # porque curso.codigo es UNIQUE y el mismo "Estudios Generales I" se repite
    # en varias carreras. SÍ se insertan (a diferencia de una regla anterior
    # que los excluía por completo): representan el slot de la malla que el
    # estudiante llena con un curso real de generales, cuyo código Banner
    # (EGF/EGC/EGS/EGA) se carga aparte en _insert_general_courses_from_banner.
    rows = []
    codes = []
    for c in unique_courses:
        code = c["codigo"]
        credits = _parse_credits(c["creditos"])
        rows.append((code, c["nombre"], credits, c.get("es_optativo", False)))
        codes.append(code)

    log.info(f"  Cursos a insertar: {len(rows)}")

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO curso (codigo, nombre, creditos, es_optativo)
            VALUES %s
            ON CONFLICT (codigo) DO UPDATE SET
                nombre = EXCLUDED.nombre,
                creditos = EXCLUDED.creditos,
                es_optativo = EXCLUDED.es_optativo,
                actualizado_en = now()
            """,
            rows,
        )
        cur.execute(
            "SELECT codigo, id_curso FROM curso WHERE codigo = ANY(%s)",
            (codes,)
        )
        course_map = {row[0]: row[1] for row in cur.fetchall()}

    # curso_carrera: una fila por (código, carrera) real de la fuente, sin
    # deduplicar -- un mismo curso puede requerirse en varias mallas.
    cc_rows = []
    for c in raw_courses:
        code = c["codigo"]
        course_id = course_map.get(code)
        career_id = career_map.get(c["carrera_sigla"])
        if not course_id:
            continue
        if not career_id:
            log.warning(f"  ⚠ {code}: carrera '{c['carrera_sigla']}' no encontrada")
            continue
        cc_rows.append((
            course_id, career_id,
            c.get("ciclo_id", ""), c.get("ciclo_nombre", ""),
        ))

    log.info(f"  Relaciones curso-carrera a insertar: {len(cc_rows)}")

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO curso_carrera (id_curso, id_carrera, ciclo_id, ciclo_nombre)
            VALUES %s
            ON CONFLICT (id_curso, id_carrera) DO UPDATE SET
                ciclo_id = EXCLUDED.ciclo_id,
                ciclo_nombre = EXCLUDED.ciclo_nombre
            """,
            cc_rows,
        )

    return course_map


# ──────────────────────────────────────────────────────────────────────────────
# PASO 3: Prerrequisitos
# ──────────────────────────────────────────────────────────────────────────────

def _insert_prerequisites(conn, course_map: dict[str, int], career_map: dict[str, int]):
    """
    Inserta prerrequisitos desde la malla (tipo='prerequisito'), con
    id_carrera resuelto desde la fila de origen (c["carrera_sigla"]).

    El Excel define prerrequisitos por hoja/carrera, y un mismo curso
    compartido entre carreras (ej. MAT002) puede tener requisitos DISTINTOS
    según la carrera (ISI exige MAT030, TOPO/ITECAD exigen solo MAT001).
    Sin id_carrera, una tabla global terminaba con la UNIÓN de todos los
    requisitos de todas las hojas -- un estudiante de TOPO se veía exigido
    un curso (MAT030) que ni siquiera existe en su malla. Se hace un
    reemplazo completo (DELETE + INSERT) en vez de upsert incremental
    porque esta tabla no tiene otra fuente de verdad más que la malla, y
    así se limpian también las filas viejas sin scope de corridas
    anteriores a este fix.
    """
    path = OUTPUT_NORMALIZED_DIR / "syllabi_normalized.json"
    with open(path, encoding="utf-8") as f:
        raw_courses = json.load(f)

    prereqs = []
    seen_triples = set()
    for c in raw_courses:
        course_id = course_map.get(c["codigo"])
        career_id = career_map.get(c["carrera_sigla"])
        if not course_id or not career_id:
            continue
        for req in c.get("prerequisitos", []):
            req_id = course_map.get(req)
            if req_id and (course_id, req_id, career_id) not in seen_triples:
                seen_triples.add((course_id, req_id, career_id))
                prereqs.append((course_id, req_id, "prerequisito", career_id))

    with conn.cursor() as cur:
        cur.execute("DELETE FROM prerrequisito WHERE tipo = 'prerequisito'")
        deleted = cur.rowcount
        if prereqs:
            execute_values(
                cur,
                """
                INSERT INTO prerrequisito (id_curso, id_curso_requerido, tipo, id_carrera)
                VALUES %s
                ON CONFLICT (id_curso, id_curso_requerido, tipo, id_carrera) DO NOTHING
                """,
                prereqs,
            )
    log.info(f"  ✓ {len(prereqs)} prerrequisitos insertados ({deleted} filas viejas reemplazadas)")


def _insert_corequisites(conn, course_map: dict[str, int], career_map: dict[str, int]):
    """
    Inserta correquisitos desde la malla en la misma tabla prerrequisito,
    con tipo='correquisito' e id_carrera resuelto igual que en
    _insert_prerequisites. El motor de prerrequisitos
    (prerrequisito.service.ts) filtra por tipo='prerequisito' al construir
    el árbol de "qué debo tener aprobado", así que estas filas nunca se
    tratan como requisito previo.
    """
    path = OUTPUT_NORMALIZED_DIR / "syllabi_normalized.json"
    with open(path, encoding="utf-8") as f:
        raw_courses = json.load(f)

    coreqs = []
    seen_triples = set()
    for c in raw_courses:
        course_id = course_map.get(c["codigo"])
        career_id = career_map.get(c["carrera_sigla"])
        if not course_id or not career_id:
            continue
        for req in c.get("correquisitos", []):
            req_id = course_map.get(req)
            if req_id and (course_id, req_id, career_id) not in seen_triples:
                seen_triples.add((course_id, req_id, career_id))
                coreqs.append((course_id, req_id, "correquisito", career_id))

    with conn.cursor() as cur:
        cur.execute("DELETE FROM prerrequisito WHERE tipo = 'correquisito'")
        deleted = cur.rowcount
        if coreqs:
            execute_values(
                cur,
                """
                INSERT INTO prerrequisito (id_curso, id_curso_requerido, tipo, id_carrera)
                VALUES %s
                ON CONFLICT (id_curso, id_curso_requerido, tipo, id_carrera) DO NOTHING
                """,
                coreqs,
            )
    log.info(f"  ✓ {len(coreqs)} correquisitos insertados ({deleted} filas viejas reemplazadas)")


def _insert_cycle_range_prerequisites(conn, course_map: dict[str, int]):
    """
    Inserta prerequisito_ciclo desde la malla (campo "prerequisito_ciclo"
    del JSON, ej. TGF425/TGF426: {"desde": "1 1", "hasta": "3 2"}).

    A diferencia de `prerrequisito`, esta tabla no lista cursos puntuales:
    guarda un rango de ciclo_id que el motor de prerrequisitos debe resolver
    contra la malla vigente en tiempo de evaluación (ver V5).
    """
    path = OUTPUT_NORMALIZED_DIR / "syllabi_normalized.json"
    with open(path, encoding="utf-8") as f:
        raw_courses = json.load(f)

    rows = []
    for c in raw_courses:
        rango = c.get("prerequisito_ciclo")
        if not rango:
            continue
        course_id = course_map.get(c["codigo"])
        if not course_id:
            log.warning(f"  ⚠ {c['codigo']}: prerequisito_ciclo sin curso insertado, se omite")
            continue
        rows.append((course_id, rango["desde"], rango["hasta"]))

    if not rows:
        log.info("  ✓ 0 prerequisitos de rango de ciclos para insertar")
        return

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO prerequisito_ciclo (id_curso, ciclo_id_desde, ciclo_id_hasta)
            VALUES %s
            ON CONFLICT (id_curso) DO UPDATE SET
                ciclo_id_desde = EXCLUDED.ciclo_id_desde,
                ciclo_id_hasta = EXCLUDED.ciclo_id_hasta
            """,
            rows,
        )
    log.info(f"  ✓ {len(rows)} prerequisitos de rango de ciclos insertados")


# ──────────────────────────────────────────────────────────────────────────────
# PASO 4-6: Secciones, profesores y horarios desde Banner
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class ProgramLoadStats:
    """Resultado de cargar una carrera de un período."""
    loaded: int = 0


@dataclass
class TermLoadStats:
    term: str
    by_program: dict[str, ProgramLoadStats] = field(default_factory=dict)
    marked_exhausted: int = 0

    @property
    def total(self) -> int:
        return sum(p.loaded for p in self.by_program.values())


def _upsert_teacher(cur, sec: dict) -> int | None:
    teacher_name = (sec.get("instructor") or "").strip()
    if not teacher_name:
        return None
    cur.execute(
        """
        INSERT INTO profesor (nombre, correo)
        VALUES (%s, %s)
        ON CONFLICT (nombre) DO UPDATE SET correo = COALESCE(EXCLUDED.correo, profesor.correo)
        RETURNING id_profesor
        """,
        (teacher_name, sec.get("instructor_email") or None),
    )
    return cur.fetchone()[0]


def _upsert_section(cur, sec: dict, period_id: int) -> int:
    """
    Upsert de una sección por (nrc, id_periodo). En conflicto se refrescan
    los datos que Banner puede cambiar entre corridas: profesor, cupos,
    metadata, fechas, título, número de sección, tipo y campus.

    NO se actualizan a propósito:
    - creditos: el MERGE (_merge_banner_syllabus) los reemplaza por los de
      la malla al matchear la sección; pisarlos con Banner en cada corrida
      revertiría esa corrección y el MERGE no la repite (id_curso ya no es
      NULL).
    - codigo_curso_banner / es_general: el NRC identifica la sección de un
      curso; si Banner reasignara un NRC a otro curso, id_curso quedaría
      apuntando al viejo -- mejor que no pase en silencio.
    """
    nrc = sec["crn"]
    cur.execute(
        """
        INSERT INTO seccion (nrc, codigo_curso_banner, id_periodo, id_profesor,
                             numero_seccion, titulo, tipo, campus,
                             creditos,
                             capacidad, inscritos, disponibles, estado_oferta,
                             es_general, fecha_inicio, fecha_fin, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'activa', %s, %s, %s, %s)
        ON CONFLICT (nrc, id_periodo) DO UPDATE SET
            id_profesor = EXCLUDED.id_profesor,
            numero_seccion = EXCLUDED.numero_seccion,
            titulo = EXCLUDED.titulo,
            tipo = EXCLUDED.tipo,
            campus = EXCLUDED.campus,
            capacidad = EXCLUDED.capacidad,
            inscritos = EXCLUDED.inscritos,
            disponibles = EXCLUDED.disponibles,
            estado_oferta = 'activa',
            fecha_inicio = EXCLUDED.fecha_inicio,
            fecha_fin = EXCLUDED.fecha_fin,
            metadata = EXCLUDED.metadata,
            actualizado_en = now()
        RETURNING id_seccion
        """,
        (
            nrc, sec["course"], period_id, _upsert_teacher(cur, sec),
            sec.get("section", ""), sec.get("title", ""),
            sec.get("type", ""), sec.get("campus", ""),
            _parse_credits(sec.get("credits", 0)),
            sec.get("capacity", 0), sec.get("enrolled", 0),
            sec.get("available", 0),
            sec.get("is_general", False),
            _parse_banner_date(sec.get("start_date"), nrc, "fecha_inicio"),
            _parse_banner_date(sec.get("end_date"), nrc, "fecha_fin"),
            json.dumps(sec.get("metadata") or {}),
        ),
    )
    return cur.fetchone()[0]


def _insert_schedule(cur, section_id: int, sec: dict) -> None:
    """
    Inserta los bloques horarios de la sección. Deduplica en memoria
    dentro de la corrida; los bloques ya existentes se dejan como están
    (ON CONFLICT DO NOTHING).
    """
    seen = set()
    for h in sec.get("schedules", []):
        start_time = _parse_time(h.get("start"))
        end_time = _parse_time(h.get("end"))
        if not (start_time and end_time):
            continue
        key = (h.get("day", ""), start_time, end_time, h.get("classroom", ""))
        if key in seen:
            continue
        seen.add(key)
        cur.execute(
            """
            INSERT INTO horario_bloque (id_seccion, dia, hora_inicio, hora_fin, aula)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (section_id, *key),
        )


def _mark_exhausted(cur, period_id: int, vigentes: set[str]) -> int:
    """
    Marca 'agotada' las secciones del período que esta corrida no trajo.
    Acotado por id_periodo: el mismo NRC puede ser otra sección en otro
    período. Nunca se borran (ver V2).
    """
    cur.execute(
        """
        UPDATE seccion SET estado_oferta = 'agotada', actualizado_en = now()
        WHERE id_periodo = %s
          AND estado_oferta <> 'agotada'
          AND NOT (nrc = ANY(%s))
        RETURNING nrc
        """,
        (period_id, list(vigentes)),
    )
    return len(cur.fetchall())


def _load_term_sections(conn, period_id: int, term: str, extraction: dict[str, dict]) -> TermLoadStats:
    """
    Carga las secciones de un período, carrera por carrera.

    extraction: {carrera: {"sections": [...], "failed_codes": [...]}}
    (ver banner_connector.extract_term).
    """
    stats = TermLoadStats(term)
    vigentes: set[str] = set()
    with conn.cursor() as cur:
        for program, data in extraction.items():
            sections = data.get("sections") or []
            pstats = ProgramLoadStats()
            stats.by_program[program] = pstats

            for sec in sections:
                section_id = _upsert_section(cur, sec, period_id)
                _insert_schedule(cur, section_id, sec)
                pstats.loaded += 1
                vigentes.add(sec["crn"])
            log.info(f"  {term}/{program}: {pstats.loaded} secciones cargadas")

        stats.marked_exhausted = _mark_exhausted(cur, period_id, vigentes)
        log.info(f"  {term}: {stats.marked_exhausted} secciones marcadas 'agotada'")
    return stats


# ──────────────────────────────────────────────────────────────────────────────
# PASO 7: Cursos de generales desde Banner (automático)
# ──────────────────────────────────────────────────────────────────────────────

def _insert_general_courses_from_banner(conn):
    """
    Inserta en curso los códigos de Estudios Generales que vienen de Banner
    y que no existen en la malla (EGF, EGC, EGS, EGA).
    Detecta automáticamente todos los códigos de generales desde las secciones.
    Si el próximo ciclo aparece un curso nuevo, se inserta solo.
    Si un curso cambia de nombre, ON CONFLICT DO UPDATE lo actualiza.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO curso (codigo, nombre, creditos,
                               id_carrera, es_general, creditos_fuente,
                               ciclo_id, ciclo_nombre, es_optativo)
            SELECT DISTINCT
                s.codigo_curso_banner,
                s.titulo,
                s.creditos,
                NULL::INTEGER,                   -- id_carrera: NULL porque son compartidos
                true,                            -- es_general
                'banner',                        -- creditos_fuente
                'Opt',                           -- ciclo_id
                'Optativos',                     -- ciclo_nombre
                false                            -- es_optativo
            FROM seccion s
            WHERE s.es_general = true
              AND s.codigo_curso_banner NOT IN (SELECT codigo FROM curso)
            ON CONFLICT (codigo) DO UPDATE SET
                nombre = EXCLUDED.nombre,
                creditos = EXCLUDED.creditos,
                es_general = true,
                creditos_fuente = 'banner',
                actualizado_en = now()
            """
        )
        inserted = cur.rowcount
    if inserted > 0:
        log.info(f"  ✓ {inserted} cursos de generales insertados desde Banner")
    else:
        log.info(f"  ✓ 0 cursos de generales nuevos (ya existían)")


# ──────────────────────────────────────────────────────────────────────────────
# PASO 9: MERGE Banner ↔ Malla
# ──────────────────────────────────────────────────────────────────────────────

def _merge_banner_syllabus(conn, course_map: dict[str, int], career_map: dict[str, int]):
    """
    Actualiza seccion.id_curso haciendo JOIN por codigo_curso_banner = curso.codigo.

    Para cursos compartidos entre carreras (ej. MAT002), prioriza el match
    con el curso que pertenece a la carrera indicada por metadata->>'banner_program'.
    Si no hay banner_program o el curso no existe para esa carrera, usa
    cualquier match (el primer curso con ese código).
    """
    # Mapa inverso: id_carrera → sigla
    id_to_sigla = {v: k for k, v in career_map.items()}

    with conn.cursor() as cur:
        # Paso 1: Match con prioridad de carrera (banner_program coincide
        # con la carrera del curso en la malla)
        cur.execute(
            """
            UPDATE seccion s
            SET id_curso = c.id_curso,
                es_general = c.es_general,
                creditos = CASE WHEN c.creditos > 0 THEN c.creditos ELSE s.creditos END,
                actualizado_en = now()
            FROM curso c
            WHERE s.codigo_curso_banner = c.codigo
              AND s.id_curso IS NULL
              AND (
                  s.metadata->>'banner_program' IS NULL
                  OR c.id_carrera = (
                      SELECT ca.id_carrera FROM carrera ca
                      WHERE ca.sigla = s.metadata->>'banner_program'
                  )
              )
            """
        )
        matched_with_program = cur.rowcount

        # Paso 2: Match sin prioridad (para las secciones que quedaron
        # huérfanas después del paso 1 — ej. banner_program no matcheó
        # con ninguna carrera en curso, o banner_program es null)
        cur.execute(
            """
            UPDATE seccion s
            SET id_curso = c.id_curso,
                es_general = c.es_general,
                creditos = CASE WHEN c.creditos > 0 THEN c.creditos ELSE s.creditos END,
                actualizado_en = now()
            FROM curso c
            WHERE s.codigo_curso_banner = c.codigo
              AND s.id_curso IS NULL
            """
        )
        matched_fallback = cur.rowcount

    total_matched = matched_with_program + matched_fallback
    log.info(f"  ✓ MERGE: {total_matched} secciones matcheadas "
             f"({matched_with_program} con prioridad de carrera, "
             f"{matched_fallback} fallback)")


# ──────────────────────────────────────────────────────────────────────────────
# PASO 10: Reporte de calidad
# ──────────────────────────────────────────────────────────────────────────────

def quality_report(conn):
    """Genera reporte de calidad: tasa de join, huérfanos, créditos en 0."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT count(*) AS total FROM seccion")
        total = cur.fetchone()["total"]

        cur.execute("SELECT count(*) AS matched FROM seccion WHERE id_curso IS NOT NULL")
        matched = cur.fetchone()["matched"]

        cur.execute("SELECT count(*) AS orphans FROM seccion WHERE id_curso IS NULL")
        orphans = cur.fetchone()["orphans"]

        rate = (matched / total * 100) if total > 0 else 0

        cur.execute("SELECT count(*) AS zero_credits FROM curso WHERE creditos = 0")
        zero_credits = cur.fetchone()["zero_credits"]

        cur.execute(
            """
            SELECT count(*) AS resolved
            FROM curso c
            WHERE c.creditos_fuente = 'banner'
            """
        )
        resolved = cur.fetchone()["resolved"]

        # Estadísticas de banner_program
        cur.execute(
            """
            SELECT
                s.metadata->>'banner_program' AS program,
                count(*) AS sections
            FROM seccion s
            GROUP BY s.metadata->>'banner_program'
            ORDER BY count(*) DESC
            """
        )
        program_stats = cur.fetchall()

        log.info(f"\n{'='*50}")
        log.info("QUALITY REPORT")
        log.info(f"{'='*50}")
        log.info(f"  Total sections:        {total}")
        log.info(f"  Matched with syllabus: {matched} ({rate:.1f}%)")
        log.info(f"  Orphans (no match):    {orphans}")
        log.info(f"  Courses with credits=0 (unresolved): {zero_credits}")
        log.info(f"  Courses resolved via Banner:         {resolved}")
        log.info(f"  Join rate:             {rate:.1f}% {'✓' if rate >= 95 else '⚠'}")
        log.info(f"  Sections by banner_program:")
        for row in program_stats:
            prog = row["program"] or "null"
            log.info(f"    {prog}: {row['sections']}")

        if orphans > 0:
            cur.execute(
                """
                SELECT nrc, codigo_curso_banner, titulo, campus
                FROM seccion
                WHERE id_curso IS NULL
                ORDER BY codigo_curso_banner
                """
            )
            orphan_records = cur.fetchall()
            path = OUTPUT_RAW_DIR / "orphaned_records.json"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(orphan_records, f, ensure_ascii=False, indent=2, default=str)
            log.info(f"  Orphans saved to: {path}")


# ──────────────────────────────────────────────────────────────────────────────
# Pipeline principal
# ──────────────────────────────────────────────────────────────────────────────

def load_catalog_and_syllabus(conn) -> dict[str, int]:
    """Paso A: carreras + malla (una vez por corrida). Devuelve career_map."""
    log.info("\n▶ Inserting catalogs...")
    career_map = _insert_careers(conn)
    log.info(f"  Careers: {list(career_map.keys())}")

    log.info("\n▶ Inserting courses from syllabus...")
    course_map = _insert_courses_from_syllabus(conn, career_map)
    log.info(f"  Courses in DB: {len(course_map)}")

    log.info("\n▶ Inserting prerequisites...")
    _insert_prerequisites(conn, course_map, career_map)

    log.info("\n▶ Inserting corequisites...")
    _insert_corequisites(conn, course_map, career_map)

    log.info("\n▶ Inserting cycle-range prerequisites...")
    _insert_cycle_range_prerequisites(conn, course_map)
    return career_map


def load_term(conn, term: str, extraction: dict[str, dict], career_map: dict[str, int]) -> TermLoadStats:
    """Paso B: un período completo. El llamador maneja commit/rollback."""
    log.info(f"\n▶ Período {term}")
    period_id = _insert_term(conn, term)
    stats = _load_term_sections(conn, period_id, term, extraction)

    _insert_general_courses_from_banner(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT codigo, id_curso FROM curso")
        course_map = {row[0]: row[1] for row in cur.fetchall()}
    _merge_banner_syllabus(conn, course_map, career_map)
    return stats


def apply_active_rule(conn, statuses: list[TermStatus], today: date) -> list:
    """
    Paso C: aplica decide_active a los períodos evaluados en esta corrida
    (candidatos ∪ activos en la BD) que existen en la tabla periodo. Uno
    que Banner no tiene y nunca se cargó no se inserta solo para apagarlo.
    """
    view_only = {st.code: st.view_only for st in statuses}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.codigo, p.activo, count(s.id_seccion), max(s.fecha_fin)
            FROM periodo p
            LEFT JOIN seccion s ON s.id_periodo = p.id_periodo
            WHERE p.codigo = ANY(%s) OR p.activo
            GROUP BY p.codigo, p.activo
            """,
            (list(view_only),),
        )
        states = [
            PeriodState(code, active, view_only.get(code, False), count, max_end)
            for code, active, count, max_end in cur.fetchall()
        ]

        decisions = decide_active(states, today)
        for st, d in zip(states, decisions):
            if d.warning:
                log.warning(f"  ⚠ {d.warning}")
            if d.active != st.active:
                cur.execute("UPDATE periodo SET activo = %s WHERE codigo = %s", (d.active, d.code))
            log.info(f"  {d.code}: activo={d.active} ({d.reason}"
                     f"{', CAMBIA' if d.active != st.active else ''})")
    return decisions


def _read_term_files() -> dict[str, dict[str, dict]]:
    """
    {periodo: {carrera: {"sections": [...], "failed_codes": []}}} desde
    output/raw/banner_{carrera}_{periodo}.json, para la ejecución standalone.
    """
    by_term: dict[str, dict[str, dict]] = defaultdict(dict)
    for file in sorted(OUTPUT_RAW_DIR.glob("banner_*_*.json")):
        m = re.fullmatch(r"banner_(\w+?)_(\d{6})\.json", file.name)
        if not m:
            continue
        with open(file, encoding="utf-8") as f:
            by_term[m.group(2)][m.group(1)] = {"sections": json.load(f), "failed_codes": []}
    return dict(by_term)


def run():
    """
    Standalone: carga la malla y todos los períodos que tengan
    banner_*_{periodo}.json en output/raw, sin pegarle a Banner. No toca
    periodo.activo (para eso hace falta getTerms: usar run_etl.py).
    """
    log.info("=" * 60)
    log.info("PostgreSQL Population (standalone, desde banner_*.json)")
    log.info("=" * 60)

    conn = _connect()
    conn.autocommit = False
    try:
        career_map = load_catalog_and_syllabus(conn)
        for term, extraction in sorted(_read_term_files().items()):
            load_term(conn, term, extraction, career_map)
        quality_report(conn)
        conn.commit()
        log.info("\n✓ Population completed and committed")
    except Exception as e:
        conn.rollback()
        log.error(f"✗ Error: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    run()
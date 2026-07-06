# extractors/populate_db.py
"""
Pipeline de poblamiento PostgreSQL — Sprint 3
=============================================
Flujo:
  1. INSERT catálogos (carrera, periodo)
  2. INSERT cursos desde syllabi_normalized.json (malla)
  3. INSERT prerrequisitos (desde la malla)
  4. INSERT secciones desde banner_*.json (Banner)
  5. INSERT profesores (desde secciones de Banner)
  6. INSERT horario_bloque (desde secciones de Banner)
  7. INSERT cursos de generales desde Banner (automático — no están en la malla)
  8. RESOLVER créditos en 0 en curso usando datos de Banner
  9. MERGE: UPDATE seccion.curso_id = curso.id_curso
     JOIN por codigo_curso_banner = curso.codigo
     Prioriza el match con la carrera indicada por banner_program.
  10. REPORTE: tasa de join, huérfanos, créditos en 0

Ejecución:
  python -m extractors.populate_db

Nota de diseño (créditos):
  Se verificó contra los datos reales de Campus Coto que ningún curso ni
  sección de Banner reporta créditos en rango (ej. "1-3"); todos son
  valores exactos. Por eso el schema y este pipeline usan una sola
  columna `creditos`, no creditos_min/creditos_max.
"""

import json
import logging
from pathlib import Path
from datetime import date
from collections import defaultdict

import psycopg2
from psycopg2.extras import execute_values, RealDictCursor

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import (
    DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD,
    OUTPUT_NORMALIZED_DIR, OUTPUT_RAW_DIR, LOGS_DIR,
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


def _parse_date(value: str) -> date | None:
    """'14/11/2026' → date(2026,11,14). Retorna None si no es válida."""
    if not value:
        return None
    try:
        parts = value.split("/")
        if len(parts) == 3:
            return date(int(parts[2]), int(parts[1]), int(parts[0]))
    except (ValueError, IndexError):
        pass
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


def _insert_term(conn, code: str, name: str) -> int:
    """Inserta o actualiza el periodo y retorna id_periodo."""
    year = int(code[:4])
    term_number = int(code[4])

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO periodo (codigo, nombre, anio, ciclo)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre
            RETURNING id_periodo
            """,
            (code, name, year, term_number),
        )
        return cur.fetchone()[0]


# ──────────────────────────────────────────────────────────────────────────────
# PASO 2: Cursos desde la malla
# ──────────────────────────────────────────────────────────────────────────────

def _insert_courses_from_syllabus(conn, career_map: dict[str, int]) -> dict[str, int]:
    """
    Inserta cursos desde syllabi_normalized.json.
    Retorna {codigo: id_curso} para el MERGE posterior.
    """
    path = OUTPUT_NORMALIZED_DIR / "syllabi_normalized.json"
    with open(path, encoding="utf-8") as f:
        raw_courses = json.load(f)

    # Deduplicar por código
    seen = set()
    unique_courses = []
    for c in raw_courses:
        code = c["codigo"]
        if code in seen:
            continue
        seen.add(code)
        unique_courses.append(c)

    # Preparar tuplas para INSERT
    # Nota: GEN1-GEN4 son placeholders genéricos de "Estudios Generales" que
    # aparecen en la malla sin prefijo de Banner (a diferencia de EGF/EGC/EGS/EGA,
    # que sí tienen prefijo y sí se cargan). Los reales llegan por separado desde
    # Banner en _insert_general_courses_from_banner. Ver Roadmap: "GEN1–GEN4
    # malla placeholders have no Banner prefix and are intentionally excluded".
    PLACEHOLDERS_GENERALES = {"GEN1", "GEN2", "GEN3", "GEN4"}

    rows = []
    codes = []
    for c in unique_courses:
        code = c["codigo"]
        if code in PLACEHOLDERS_GENERALES:
            log.info(f"  ⏭ {code}: placeholder de generales, excluido a propósito")
            continue
        credits = _parse_credits(c["creditos"])
        career_id = career_map.get(c["carrera_sigla"])
        if not career_id:
            log.warning(f"  ⚠ {code}: carrera '{c['carrera_sigla']}' no encontrada")
            continue
        rows.append((
            code, c["nombre"], credits, career_id,
            c.get("ciclo_id", ""), c.get("ciclo_nombre", ""),
            c.get("es_optativo", False),
        ))
        codes.append(code)

    log.info(f"  Cursos a insertar: {len(rows)}")

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO curso (codigo, nombre, creditos,
                               id_carrera, ciclo_id, ciclo_nombre, es_optativo)
            VALUES %s
            ON CONFLICT (codigo) DO UPDATE SET
                nombre = EXCLUDED.nombre,
                creditos = EXCLUDED.creditos,
                ciclo_id = EXCLUDED.ciclo_id,
                ciclo_nombre = EXCLUDED.ciclo_nombre,
                es_optativo = EXCLUDED.es_optativo,
                actualizado_en = now()
            """,
            rows,
        )
        cur.execute(
            "SELECT codigo, id_curso FROM curso WHERE codigo = ANY(%s)",
            (codes,)
        )
        return {row[0]: row[1] for row in cur.fetchall()}


# ──────────────────────────────────────────────────────────────────────────────
# PASO 3: Prerrequisitos
# ──────────────────────────────────────────────────────────────────────────────

def _insert_prerequisites(conn, course_map: dict[str, int]):
    """Inserta prerrequisitos desde la malla."""
    path = OUTPUT_NORMALIZED_DIR / "syllabi_normalized.json"
    with open(path, encoding="utf-8") as f:
        raw_courses = json.load(f)

    prereqs = []
    seen_pairs = set()
    for c in raw_courses:
        course_id = course_map.get(c["codigo"])
        if not course_id:
            continue
        for req in c.get("prerequisitos", []):
            req_id = course_map.get(req)
            if req_id and (course_id, req_id) not in seen_pairs:
                seen_pairs.add((course_id, req_id))
                prereqs.append((course_id, req_id))

    if not prereqs:
        log.info("  ✓ 0 prerrequisitos para insertar")
        return

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO prerrequisito (id_curso, id_curso_requerido)
            VALUES %s
            ON CONFLICT (id_curso, id_curso_requerido) DO NOTHING
            """,
            prereqs,
        )
    log.info(f"  ✓ {len(prereqs)} prerrequisitos insertados")


# ──────────────────────────────────────────────────────────────────────────────
# PASO 4-6: Secciones, profesores y horarios desde Banner
# ──────────────────────────────────────────────────────────────────────────────

def _insert_sections_from_banner(conn, period_id: int, career_map: dict[str, int]) -> dict[str, list[int]]:
    """
    Inserta secciones, profesores y horarios desde los archivos banner_*.json.
    Retorna {codigo_curso_banner: [id_seccion, ...]} para el MERGE.

    Los archivos banner_*.json usan campos en inglés (crn, course, title, etc.)
    desde la actualización del banner_connector (jul/2026).
    """
    files = list(OUTPUT_RAW_DIR.glob("banner_*_202620.json"))
    if not files:
        log.warning("  ⚠ No se encontraron archivos banner_*_202620.json")
        return {}

    all_sections = []
    for file in files:
        with open(file, encoding="utf-8") as f:
            all_sections.extend(json.load(f))

    log.info(f"  Secciones cargadas: {len(all_sections)}")

    sections_by_code = defaultdict(list)

    with conn.cursor() as cur:
        for sec in all_sections:
            # ── Profesor ──────────────────────────────────────────────────
            teacher_id = None
            teacher_name = (sec.get("instructor") or "").strip()
            teacher_email = None
            if teacher_name:
                cur.execute(
                    """
                    INSERT INTO profesor (nombre, correo)
                    VALUES (%s, %s)
                    ON CONFLICT (nombre) DO UPDATE SET correo = COALESCE(EXCLUDED.correo, profesor.correo)
                    RETURNING id_profesor
                    """,
                    (teacher_name, teacher_email),
                )
                teacher_id = cur.fetchone()[0]

            # ── Créditos ──────────────────────────────────────────────────
            credits = _parse_credits(sec.get("credits", 0))

            # ── Fechas ────────────────────────────────────────────────────
            start_date = _parse_date(sec.get("start_date"))
            end_date = _parse_date(sec.get("end_date"))

            # ── Metadata ──────────────────────────────────────────────────
            metadata = sec.get("metadata") or {}

            # ── Sección ───────────────────────────────────────────────────
            cur.execute(
                """
                INSERT INTO seccion (nrc, codigo_curso_banner, id_periodo, id_profesor,
                                     numero_seccion, titulo, tipo, campus,
                                     creditos,
                                     capacidad, inscritos, disponibles,
                                     es_general, fecha_inicio, fecha_fin, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (nrc, id_periodo) DO UPDATE SET
                    id_profesor = EXCLUDED.id_profesor,
                    capacidad = EXCLUDED.capacidad,
                    inscritos = EXCLUDED.inscritos,
                    disponibles = EXCLUDED.disponibles,
                    metadata = EXCLUDED.metadata,
                    actualizado_en = now()
                RETURNING id_seccion
                """,
                (
                    sec["crn"], sec["course"], period_id, teacher_id,
                    sec.get("section", ""), sec.get("title", ""),
                    sec.get("type", ""), sec.get("campus", ""),
                    credits,
                    sec.get("capacity", 0), sec.get("enrolled", 0),
                    sec.get("available", 0),
                    sec.get("is_general", False),
                    start_date, end_date,
                    json.dumps(metadata),
                ),
            )
            section_id = cur.fetchone()[0]
            sections_by_code[sec["course"]].append(section_id)

                       # ── Horarios ──────────────────────────────────────────────────
            # Deduplicar en memoria antes de insertar. No podemos confiar en
            # ON CONFLICT porque horario_bloque no tiene restricción UNIQUE
            # sobre (id_seccion, dia, hora_inicio, hora_fin). Usamos un Set
            # de tuplas para filtrar duplicados dentro de esta corrida.
            seen_blocks = set()
            for h in sec.get("schedules", []):
                start_time = _parse_time(h.get("start"))
                end_time = _parse_time(h.get("end"))
                if start_time and end_time:
                    day = h.get("day", "")
                    classroom = h.get("classroom", "")
                    key = (section_id, day, start_time, end_time, classroom)
                    if key not in seen_blocks:
                        seen_blocks.add(key)
                        cur.execute(
                            """
                            INSERT INTO horario_bloque (id_seccion, dia, hora_inicio, hora_fin, aula)
                            VALUES (%s, %s, %s, %s, %s)
                            ON CONFLICT DO NOTHING
                            """,
                            (section_id, day, start_time, end_time, classroom),
                        )
    return dict(sections_by_code)


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
# PASO 8: Resolver créditos en 0 en curso usando datos de Banner
# ──────────────────────────────────────────────────────────────────────────────

def _resolve_zero_credits_from_banner(conn):
    """
    Resuelve cursos con creditos = 0 en la malla usando los créditos
    reales reportados por Banner (ej. EIF200: malla=0, Banner=3).

    Toma el máximo de créditos entre todas las secciones de Banner que
    matchean con el código del curso, y solo actualiza si ese valor es > 0.
    Marca creditos_fuente = 'banner' para dejar rastro de auditoría.

    IMPORTANTE: este paso corrige `curso` usando `seccion` como fuente de
    verdad. Es el sentido inverso del MERGE (paso 9), que corrige
    `seccion` usando `curso`. Ambos son necesarios y no son intercambiables:
    - Este paso (8) resuelve datos faltantes/incorrectos en la malla.
    - El MERGE (9) asigna id_curso y homogeniza secciones huérfanas.
    Debe ejecutarse ANTES del MERGE para que el reporte de calidad refleje
    los créditos ya corregidos.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE curso c
            SET creditos = sub.creditos_banner,
                creditos_fuente = 'banner',
                actualizado_en = now()
            FROM (
                SELECT
                    codigo_curso_banner,
                    max(creditos) AS creditos_banner
                FROM seccion
                WHERE creditos > 0
                GROUP BY codigo_curso_banner
            ) sub
            WHERE c.codigo = sub.codigo_curso_banner
              AND c.creditos = 0
            """
        )
        resolved = cur.rowcount
    if resolved > 0:
        log.info(f"  ✓ {resolved} cursos con créditos en 0 resueltos usando datos de Banner")
    else:
        log.info(f"  ✓ 0 cursos con créditos en 0 requerían resolución")


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

def _quality_report(conn):
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
        log.info(f"QUALITY REPORT — Sprint 3")
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
            path = Path("output/raw/orphaned_records.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(orphan_records, f, ensure_ascii=False, indent=2, default=str)
            log.info(f"  Orphans saved to: {path}")


# ──────────────────────────────────────────────────────────────────────────────
# Pipeline principal
# ──────────────────────────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("Sprint 3 — PostgreSQL Population")
    log.info("=" * 60)

    conn = _connect()
    conn.autocommit = False

    try:
        # 1. Catálogos
        log.info("\n▶ Inserting catalogs...")
        career_map = _insert_careers(conn)
        log.info(f"  Careers: {list(career_map.keys())}")

        period_id = _insert_term(conn, "202620", "Ciclo II 2026")
        log.info(f"  Term: 202620 (id={period_id})")

        # 2. Cursos desde la malla
        log.info("\n▶ Inserting courses from syllabus...")
        course_map = _insert_courses_from_syllabus(conn, career_map)
        log.info(f"  Courses in DB: {len(course_map)}")

        # 3. Prerrequisitos
        log.info("\n▶ Inserting prerequisites...")
        _insert_prerequisites(conn, course_map)

        # 4-6. Secciones desde Banner
        log.info("\n▶ Inserting sections from Banner...")
        _insert_sections_from_banner(conn, period_id, career_map)

        # 7. Cursos de generales desde Banner (automático)
        log.info("\n▶ Inserting general courses from Banner...")
        _insert_general_courses_from_banner(conn)

        # 8. Resolver créditos en 0 usando Banner (ANTES del merge)
        log.info("\n▶ Resolving zero-credit courses from Banner...")
        _resolve_zero_credits_from_banner(conn)

        # Re-cargar course_map para incluir los generales recién insertados
        with conn.cursor() as cur:
            cur.execute("SELECT codigo, id_curso FROM curso")
            course_map = {row[0]: row[1] for row in cur.fetchall()}
        log.info(f"  Total courses in DB: {len(course_map)}")

        # 9. MERGE (ahora con prioridad de carrera via banner_program)
        log.info("\n▶ Merging Banner ↔ Syllabus...")
        _merge_banner_syllabus(conn, course_map, career_map)

        # 10. Reporte
        _quality_report(conn)

        conn.commit()
        log.info(f"\n✓ Population completed and committed")

    except Exception as e:
        conn.rollback()
        log.error(f"✗ Error: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    run()
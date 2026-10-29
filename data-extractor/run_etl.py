# run_etl.py
# Punto de entrada único del ETL, pensado para automatización (cron diario
# en .github/workflows/etl.yml, todo el año).
#
# Flujo:
#   0. Chequeo de conexión a la BD (SELECT 1, timeout corto). Si falla se
#      aborta ANTES de pegarle a Banner, con host/puerto/error en el log.
#   1. Malla: excel_loader genera syllabi_normalized.json (no está en git)
#      y populate_db carga carreras/cursos/prerrequisitos. Una sola vez.
#   2. Descubrimiento de períodos (extractors/terms.py): candidatos
#      (año actual + siguiente) × {10, 20, 95} ∪ activos en la BD, probados
#      contra Banner. Override manual: CICLOS=202620,202695.
#   3. Por cada período a extraer: Banner -> carga, en SU transacción. Si un
#      período falla se loggea, se sigue con los demás y el proceso termina
#      con exit code != 0.
#   4. Regla de periodo.activo (extractors/terms.decide_active).
#
# La protección que antes daba el guard de meses (no correr fuera de
# matrícula) la da ahora la regla de 0 secciones: un Banner vacío o con
# errores nunca marca secciones 'agotada' ni apaga un período.
#
# Uso:
#   python run_etl.py              corrida completa
#   python run_etl.py --check-db   solo verifica la conexión y lista periodos
#   CICLOS=202620 python run_etl.py   fuerza períodos (respeta View Only)

import argparse
import logging
import os
import sys
from datetime import date

from config import CICLOS_OVERRIDE_ENV, LOGS_DIR, DB_HOST, DB_PORT
from extractors import banner_connector, excel_loader, populate_db
from extractors.terms import discover_terms, parse_override

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOGS_DIR / "run_etl.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)


def check_db() -> list[tuple[str, bool]] | None:
    """Paso 0. Devuelve los períodos, o None si la BD no responde."""
    log.info(f"▶ Chequeo de conexión a PostgreSQL ({DB_HOST}:{DB_PORT})")
    try:
        periodos = populate_db.check_db_connection()
    except populate_db.DatabaseUnavailableError as e:
        log.error(f"✗ {e}")
        log.error("✗ ETL abortado antes de consultar Banner")
        return None
    log.info(f"  ✓ Conexión OK -- {len(periodos)} períodos en la BD:")
    for codigo, activo in periodos:
        log.info(f"    {codigo}  activo={activo}")
    return periodos


def run(today: date) -> int:
    periodos = check_db()
    if periodos is None:
        return 2

    override = parse_override(os.getenv(CICLOS_OVERRIDE_ENV))
    active_in_db = [codigo for codigo, activo in periodos if activo]

    log.info("▶ Paso 1: malla (excel_loader + populate_db)")
    if not excel_loader.run():
        log.error("✗ excel_loader no generó la malla, se aborta")
        return 1

    conn = populate_db._connect()
    conn.autocommit = False
    failed_terms: list[str] = []
    try:
        career_map = populate_db.load_catalog_and_syllabus(conn)
        conn.commit()

        log.info(
            "▶ Paso 2: descubrimiento de períodos"
            + (f" (override {CICLOS_OVERRIDE_ENV}={','.join(override)})" if override else "")
        )
        statuses = discover_terms(today, active_in_db, override or None)
        to_extract = [st.code for st in statuses if st.extract]
        log.info(f"  Períodos a extraer: {', '.join(to_extract) or 'ninguno'}")

        for term in to_extract:
            log.info(f"▶ Paso 3: período {term}")
            try:
                extraction = banner_connector.extract_term(term)
                stats = populate_db.load_term(conn, term, extraction, career_map)
                conn.commit()
                log.info(f"  ✓ {term}: {stats.total} secciones cargadas y confirmadas")
            except Exception:
                conn.rollback()
                log.exception(f"  ✗ {term}: falló, se revierte solo este período")
                failed_terms.append(term)

        log.info("▶ Paso 4: regla de periodo.activo")
        populate_db.apply_active_rule(conn, statuses, today)
        conn.commit()

        populate_db.quality_report(conn)
    except Exception:
        conn.rollback()
        log.exception("✗ ETL falló")
        return 1
    finally:
        conn.close()

    if failed_terms:
        log.error(f"✗ ETL terminó con períodos fallidos: {', '.join(failed_terms)}")
        return 1
    log.info("✓ ETL completado")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="ETL Banner + Malla de SIHA")
    parser.add_argument(
        "--check-db", action="store_true",
        help="solo verifica la conexión a la BD y lista los períodos",
    )
    args = parser.parse_args()

    if args.check_db:
        return 0 if check_db() is not None else 2
    return run(date.today())


if __name__ == "__main__":
    sys.exit(main())

# run_etl.py
# Punto de entrada único del ETL, pensado para automatización (cron diario
# en .github/workflows/etl.yml, todo el año).
#
# Flujo:
#   1. Malla: populate_db carga carreras/cursos/prerrequisitos desde
#      syllabi_normalized.json. Una sola vez.
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
#   CICLOS=202620 python run_etl.py   fuerza períodos (respeta View Only)

import logging
import os
import sys
from datetime import date

from config import CICLOS_OVERRIDE_ENV, LOGS_DIR
from extractors import banner_connector, populate_db
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


def run(today: date) -> int:
    override = parse_override(os.getenv(CICLOS_OVERRIDE_ENV))

    log.info("▶ Paso 1: malla (populate_db)")
    conn = populate_db._connect()
    conn.autocommit = False
    with conn.cursor() as cur:
        cur.execute("SELECT codigo FROM periodo WHERE activo")
        active_in_db = [row[0] for row in cur.fetchall()]
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
    return run(date.today())


if __name__ == "__main__":
    sys.exit(main())

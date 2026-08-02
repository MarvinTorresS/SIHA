# run_etl.py
# Punto de entrada único del ETL, pensado para automatización (cron).
#
# Ejecuta banner_connector.run() + populate_db.run() en secuencia, pero solo
# si debe_correr_etl() (ver config.py) da luz verde -- es decir, solo dentro
# de los meses de matrícula activa (Enero/Julio/Noviembre). Disparado a
# diario por .github/workflows/etl.yml; el guard es el que decide si la
# corrida realmente hace algo o se salta sin tocar la base de datos.
#
# Uso manual: python run_etl.py (ejecutar desde data-extractor/, o desde
# cualquier lado -- Python agrega el directorio de este script a sys.path
# automáticamente, así que las importaciones de config/extractors resuelven
# igual).
#
# Prueba manual forzando el guard: FORZAR_ETL=true python run_etl.py
# (o vía el input "forzar_guard" del workflow_dispatch en GitHub Actions).
# Uso pensado SOLO para pruebas puntuales fuera de la ventana de matrícula --
# corre contra la base de datos real (la que esté configurada en las
# variables de entorno DATABASE_*), no es una simulación con datos falsos.
# El disparador automático (cron diario) nunca pasa FORZAR_ETL=true.

import logging
import os
import sys

from config import debe_correr_etl, LOGS_DIR
from extractors import banner_connector, populate_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOGS_DIR / "run_etl.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)


def main() -> int:
    forzado = os.getenv("FORZAR_ETL", "").strip().lower() == "true"

    if forzado:
        debe_correr, razon = True, "forzado manualmente (FORZAR_ETL=true) -- ignora el guard de mes"
        log.warning(f"⚠ Guard de ventana de matrícula OMITIDO — {razon}")
    else:
        debe_correr, razon = debe_correr_etl()

    if not debe_correr:
        log.info(f"ETL omitido — {razon}")
        return 0

    log.info(f"ETL habilitado — {razon}")

    log.info("▶ Paso 1/2: banner_connector (scraping de secciones en Banner)")
    banner_connector.run()

    log.info("▶ Paso 2/2: populate_db (carga a PostgreSQL)")
    populate_db.run()

    log.info("✓ ETL completado")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# config.py
# Fuente única de verdad para todas las constantes del módulo ETL.
# Importar desde cualquier extractor: from config import BANNER_BASE_URL, TERM_SUFFIXES

import os
from pathlib import Path
from dotenv import load_dotenv

# ── Rutas del proyecto ────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
OUTPUT_RAW_DIR       = BASE_DIR / "output" / "raw"
OUTPUT_NORMALIZED_DIR = BASE_DIR / "output" / "normalized"
LOGS_DIR             = BASE_DIR / "logs"

# Crear directorios si no existen al importar el módulo
for _dir in (OUTPUT_RAW_DIR, OUTPUT_NORMALIZED_DIR, LOGS_DIR):
    _dir.mkdir(parents=True, exist_ok=True)

# Carreras del Campus Coto a procesar.
# Clave: sigla interna. Valor: nombre legible para logs.
# isi/itecad/topo: sigla usada originalmente en la URL de botsrb.info
# (malla_scraper.py, eliminado — ver nota arriba).
# ingles/adm: agregadas para excel_loader.py (PLANES_DE_ESTUDIO.xlsx) — no
# tienen equivalente en botsrb.info porque nunca se scrapearon; la sigla es
# arbitraria, elegida solo por consistencia de estilo con las demás.
# Ampliar esta lista cuando se agreguen carreras al campus.
CARRERAS_CAMPUS_COTO: dict[str, str] = {
    "isi":    "Ingeniería en Sistemas Informáticos",
    "itecad": "Ingeniería en Ciencia de Datos",
    "topo":   "Topografía",
    "ingles": "Enseñanza del Inglés",
    "adm":    "Administración",
}

# ── Banner (catálogo de cursos UNA) ──────────────────────────────────────────
BANNER_BASE_URL = "https://studentssb.una.ac.cr"

# Endpoints documentados en el análisis de fuentes
BANNER_SEARCH_RESULTS_PATH   = "/StudentRegistrationSsb/ssb/searchResults/searchResults"
BANNER_CLASS_DETAILS_PATH    = "/StudentRegistrationSsb/ssb/searchResults/getClassDetails"
BANNER_RESTRICTIONS_PATH     = "/StudentRegistrationSsb/ssb/searchResults/getRestrictions"

BANNER_GET_TERMS_PATH = "/StudentRegistrationSsb/ssb/classSearch/getTerms"

# Ya no hay un "ciclo activo" fijo: el ETL descubre los períodos solo (ver
# extractors/terms.py). Códigos de período de Banner: YYYYNN. Solo se
# manejan ciclos semestrales y el verano; cualquier otro sufijo
# (cuatrimestres 03/13/23, trimestres 05/15/25, anual 00) es un error
# explícito, nunca una carga silenciosa.
# Verano = sufijo 95, NO 30 (precedente: 202595 "CICLO III (VERANO) 2025").
TERM_SUFFIXES: dict[str, tuple[int, str]] = {
    "10": (1, "Ciclo I"),
    "20": (2, "Ciclo II"),
    "95": (3, "Ciclo III (Verano)"),
}

# Override manual del descubrimiento: lista de códigos separada por comas
# (ej. CICLOS=202620,202695). Vacío = descubrir solo.
CICLOS_OVERRIDE_ENV = "CICLOS"

# Código de campus de Banner para Campus Coto (descripción "SRB: Campus
# Coto"). Verificado el 28/oct/2026: searchResults con txt_campus=BC trae
# TODAS las secciones de Coto que también aparecen buscando curso por
# curso (63 de 63 en 202620), así que sirve para descubrir períodos.
BANNER_CAMPUS_COTO_CODE = "BC"

# Texto usado para filtrar secciones del Campus Coto en la búsqueda por curso
CAMPUS_COTO_FILTER_TEXT = "Campus Coto"

# ── Mapeo Banner → carrera interna ───────────────────────────────────────────
# Códigos de programa de Banner (extraídos del HTML de getRestrictions,
# confirmados manualmente inspeccionando el modal "Restricciones") mapeados
# a la sigla interna de carrera usada en todo el sistema.
#
#   BA-INFORM   → Bach Ing. Sistemas Información        → isi
#   BA-TOPOGR   → Bach Topografía y Catastro             → topo
#   BA-TECOMCD  → Ba. Ing Tec Comp Ciencia Datos         → itecad
#   BA-ADMINI   → Bach. Administración                   → adm
#   BA-INGLES   → Bach Enseñanza del Inglés               → ingles
#
# Confirmado (04/jul/2026): TODAS las secciones traen el bloque de
# programas en getRestrictions, no solo las compartidas — por lo tanto
# es una fuente confiable para validar/asignar carrera, no solo un
# parche para casos ambiguos como MAT.
#
# BA-ADMINI / BA-INGLES confirmados el 11/jul/2026 con getRestrictions
# real (CRN 51371/ETA400 y CRN 50927/LLH401, Campus Coto, ciclo 202620).
BANNER_PROGRAM_TO_CARRERA: dict[str, str] = {
    "BA-INFORM":  "isi",
    "BA-TOPOGR":  "topo",
    "BA-TECOMCD": "itecad",
    "BA-ADMINI":  "adm",
    "BA-INGLES":  "ingles",
}

# ── HTTP ─────────────────────────────────────────────────────────────────────
# Cabeceras comunes para simular un navegador real y evitar bloqueos básicos.
DEFAULT_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT_SECONDS = 15
MAX_RETRY_ATTEMPTS      = 3
RETRY_BACKOFF_FACTOR    = 2   # Espera: 2s, 4s, 8s entre reintentos

# ── Base de datos (Sprint 3) ──────────────────────────────────────────────────
DB_HOST = os.getenv("DATABASE_HOST", "localhost")
DB_PORT = int(os.getenv("DATABASE_PORT", "5432"))
DB_NAME = os.getenv("DATABASE_NAME", "sistema_horarios")
DB_USER = os.getenv("DATABASE_USER", "horarios")
DB_PASSWORD = os.getenv("DATABASE_PASSWORD", "horarios_dev")

# Timeout corto para el chequeo de conexión inicial de run_etl.py: si la BD
# no responde, abortar en segundos ANTES de pegarle a Banner.
DB_CONNECT_TIMEOUT_SECONDS = 10

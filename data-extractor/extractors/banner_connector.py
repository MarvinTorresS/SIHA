# extractors/banner_connector.py
#
# Conector Banner — Student Registration SSB (UNA)
# Flujo: una sesión POR CADA CURSO
#
# Pasos por curso:
#   1. GET term/termSelection → token
#   2. POST term/search       → activar 202620
#   3. GET searchResults      → JSON completo (secciones + faculty + meetingsFaculty)
#
# getClassDetails ya NO se usa: toda la info está en el JSON de searchResults.

import re
import time
import json
import logging
from html import unescape
from pathlib import Path
from collections import defaultdict
from typing import Optional

import requests

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import (
    REQUEST_TIMEOUT_SECONDS,
    MAX_RETRY_ATTEMPTS,
    RETRY_BACKOFF_FACTOR,
    OUTPUT_RAW_DIR,
    LOGS_DIR,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOGS_DIR / "banner_connector.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

BANNER_BASE = "https://studentssb.una.ac.cr/StudentRegistrationSsb/ssb"
TERM_CODE   = "202620"

# Subjects por carrera
# Los generales (EGF, EGC, EGS, EGA) se buscan con códigos fijos ya conocidos
SUBJECTS_POR_CARRERA = {
    "isi":    ["EIF", "MAT", "LIX", "EGF", "EGC", "EGS", "EGA"],
    "itecad": ["TDC", "MAT", "LIX", "EGF", "EGC", "EGS", "EGA"],
    "topo":   ["TGF", "MAT", "LIX", "FIY", "EGF", "EGC", "EGS", "EGA"],
}

# Códigos de Estudios Generales confirmados en Campus Coto (diagnóstico exhaustivo)
CODIGOS_GENERALES_COTO = [
    "EGF128", "EGC116", "EGS101", "EGS117", "EGS118", "EGS120", "EGA121"
]

# Mapa de campo booleano en meetingTime → nombre del día
_DIAS_BOOL = {
    "monday":    "Lunes",
    "tuesday":   "Martes",
    "wednesday": "Miércoles",
    "thursday":  "Jueves",
    "friday":    "Viernes",
    "saturday":  "Sábado",
    "sunday":    "Domingo",
}

# Set de subjects de Estudios Generales (única fuente de verdad)
_SUBJECTS_GENERALES = {"EGF", "EGC", "EGS", "EGA"}

_cache_codigos_malla: dict[str, set[str]] | None = None


# ──────────────────────────────────────────────────────────────────────────────
# Parsers sobre el JSON de searchResults
# ──────────────────────────────────────────────────────────────────────────────

def _fmt_hora(t: str | None) -> str:
    """'0800' → '08:00'. Descarta valores no numéricos o longitud != 4."""
    if not t or len(t) != 4 or not t.isdigit():
        return t or ""
    return f"{t[:2]}:{t[2:]}"


def _parse_horarios(meetings: list[dict]) -> list[dict]:
    """
    Devuelve una lista de bloques de horario.
    Cada bloque incluye día, inicio, fin y aula.
    Si un curso tiene teoría en un aula y laboratorio en otra,
    cada uno aparece como un bloque separado con su propia aula.
    """
    horarios = []
    for bloque in meetings:
        mt = bloque.get("meetingTime") or {}
        inicio = _fmt_hora(mt.get("beginTime"))
        fin    = _fmt_hora(mt.get("endTime"))
        if not inicio or not fin:
            continue
        building = mt.get("building") or mt.get("buildingDescription") or ""
        room     = mt.get("room") or ""
        aula = f"{building}-{room}".strip("-")
        for campo, nombre in _DIAS_BOOL.items():
            if mt.get(campo):
                horarios.append({
                    "dia":    nombre,
                    "inicio": inicio,
                    "fin":    fin,
                    "aula":   aula,
                })
    return horarios


def _parse_profesor(faculty: list[dict]) -> str:
    """
    Nombre del instructor primario; si no hay primario, el primero.
    Blindado contra displayName ausente o de tipo inesperado.
    """
    if not faculty:
        return ""
    primario = next((f for f in faculty if f.get("primaryIndicator")), faculty[0])
    nombre = primario.get("displayName") or ""
    return unescape(str(nombre))


def _parse_creditos(sec: dict) -> int | float | str:
    """
    Extrae créditos del JSON.
    Si creditHourLow != creditHourHigh, devuelve string "low-high".
    """
    low = sec.get("creditHourLow")
    high = sec.get("creditHourHigh")
    if low is not None and high is not None and low != high:
        return f"{low}-{high}"
    return low or high or sec.get("creditHours") or sec.get("numberOfUnits") or 0


def _parse_fechas(meetings: list[dict]) -> tuple[str, str]:
    """Extrae fecha_inicio y fecha_fin del primer bloque de reunión."""
    if not meetings:
        return "", ""
    mt = meetings[0].get("meetingTime") or {}
    return mt.get("startDate") or "", mt.get("endDate") or ""


def _es_subject_general(codigo: str) -> bool:
    """
    Verifica si un código de curso pertenece a Estudios Generales.
    Acepta tanto el código completo (EGF128) como solo el prefijo (EGF).
    """
    prefijo = codigo[:3] if len(codigo) >= 3 else codigo
    return prefijo in _SUBJECTS_GENERALES


# ──────────────────────────────────────────────────────────────────────────────
# Ensamblado de sección (función extraída para testeo aislado)
# ──────────────────────────────────────────────────────────────────────────────

def _ensamblar_seccion(sec: dict, codigo: str) -> dict:
    """
    Convierte un dict de sección del JSON de Banner en el formato
    normalizado de salida del ETL.
    """
    nrc      = sec.get("courseReferenceNumber", "")
    meetings = sec.get("meetingsFaculty") or []
    faculty  = sec.get("faculty") or []
    fecha_inicio, fecha_fin = _parse_fechas(meetings)

    return {
        "nrc":      nrc,
        "curso":    codigo,
        "titulo":   unescape(sec.get("courseTitle") or ""),
        "creditos": _parse_creditos(sec),
        "campus":   unescape(sec.get("campusDescription") or ""),
        "tipo":     unescape(sec.get("scheduleTypeDescription") or ""),
        "seccion":  sec.get("sequenceNumber") or "",
        "capacidad":   sec.get("maximumEnrollment") or 0,
        "inscritos":   sec.get("enrollment") or 0,
        "disponibles": sec.get("seatsAvailable") or 0,
        "profesor":    _parse_profesor(faculty),
        "horarios":    _parse_horarios(meetings),
        "fecha_inicio": fecha_inicio,
        "fecha_fin":    fecha_fin,
        "es_general":   _es_subject_general(codigo),
    }


# ──────────────────────────────────────────────────────────────────────────────
# BannerSession — una sesión efímera por curso
# ──────────────────────────────────────────────────────────────────────────────

def _gen_id() -> str:
    import random, string
    chars = string.ascii_lowercase + string.digits
    return f"{''.join(random.choices(chars, k=5))}{int(time.time() * 1000)}"


def _extraer_token(html: str) -> str:
    patrones = [
        r'<meta\s+name="synchronizerToken"\s+content="([^"]+)"',
        r'<input[^>]+name="synchronizerToken"[^>]+value="([^"]+)"',
        r'"synchronizerToken"\s*:\s*"([^"]+)"',
        r"synchronizerToken['\"]?\s*[=:]\s*['\"]([^'\"]+)",
    ]
    for pat in patrones:
        m = re.search(pat, html, re.I)
        if m:
            return m.group(1)
    raise ValueError("synchronizerToken no encontrado en la respuesta de Banner")


class BannerSession:

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        })
        self._token: Optional[str] = None
        self._uid:   Optional[str] = None

    def _req(self, method: str, url: str, **kwargs) -> requests.Response:
        for intento in range(1, MAX_RETRY_ATTEMPTS + 1):
            try:
                resp = self.session.request(
                    method, url, timeout=REQUEST_TIMEOUT_SECONDS, **kwargs
                )
                if resp.status_code in (429, 500, 502, 503):
                    t = RETRY_BACKOFF_FACTOR ** intento
                    log.debug(f"HTTP {resp.status_code} — reintento {intento} en {t:.1f}s")
                    time.sleep(t)
                    continue
                resp.raise_for_status()
                return resp
            except requests.RequestException as e:
                if intento == MAX_RETRY_ATTEMPTS:
                    raise
                time.sleep(RETRY_BACKOFF_FACTOR ** intento)

    def login(self) -> None:
        r = self._req("GET", f"{BANNER_BASE}/term/termSelection?mode=courseSearch")
        self._token = _extraer_token(r.text)
        self._uid   = _gen_id()
        self._req(
            "POST", f"{BANNER_BASE}/term/search?mode=courseSearch",
            data={
                "term": TERM_CODE, "studyPath": "", "studyPathText": "",
                "startDatepicker": "", "endDatepicker": "",
                "uniqueSessionId": self._uid,
            },
            headers={
                "x-synchronizer-token": self._token,
                "x-requested-with":     "XMLHttpRequest",
                "accept":               "*/*",
                "content-type":         "application/x-www-form-urlencoded; charset=UTF-8",
                "referer": f"{BANNER_BASE}/term/termSelection?mode=courseSearch",
            },
        )

    def search(self, codigo: str) -> list[dict]:
        r = self._req(
            "GET", f"{BANNER_BASE}/searchResults/searchResults",
            params={
                "txt_subjectcoursecombo": codigo,
                "txt_term":      TERM_CODE,
                "pageOffset":    0,
                "pageMaxSize":   50,
                "sortColumn":    "subjectDescription",
                "sortDirection": "asc",
                "uniqueSessionId": self._uid,
                "_": int(time.time() * 1000),
            },
            headers={
                "x-synchronizer-token": self._token,
                "x-requested-with":     "XMLHttpRequest",
                "accept": "application/json, text/javascript, */*; q=0.01",
                "referer": f"{BANNER_BASE}/courseSearch/courseSearch",
            },
        )
        data = r.json()
        return (data.get("data") or []) if data.get("success") else []

    def close(self):
        self.session.close()


# ──────────────────────────────────────────────────────────────────────────────
# Extracción por carrera
# ──────────────────────────────────────────────────────────────────────────────

def _cargar_codigos_malla(forzar_reload: bool = False) -> dict[str, set[str]]:
    """
    Carga los códigos de curso desde la malla normalizada.
    Cachea el resultado. Usar forzar_reload=True para invalidar caché.
    """
    global _cache_codigos_malla
    if _cache_codigos_malla is not None and not forzar_reload:
        return _cache_codigos_malla
    ruta = Path("output/normalized/syllabi_normalized.json")
    with open(ruta, encoding="utf-8") as f:
        cursos = json.load(f)
    codigos: dict[str, set[str]] = defaultdict(set)
    for c in cursos:
        codigos[c["carrera_sigla"]].add(c["codigo"])
    _cache_codigos_malla = dict(codigos)
    return _cache_codigos_malla


def extraer_carrera(sigla: str, subjects: list[str]) -> list[dict]:
    codigos_malla = _cargar_codigos_malla().get(sigla, set())

    # Separar subjects regulares de generales
    subjects_regulares = [s for s in subjects if not _es_subject_general(s)]
    subjects_generales = [s for s in subjects if _es_subject_general(s)]

    # Códigos regulares: de la malla
    codigos = sorted(c for c in codigos_malla if any(c.startswith(s) for s in subjects_regulares))

    # Códigos generales: lista fija ya diagnosticada
    codigos_generales = CODIGOS_GENERALES_COTO if subjects_generales else []

    todos_codigos = codigos + codigos_generales
    log.info(f"▶ {sigla}: {len(todos_codigos)} códigos ({len(codigos)} malla + {len(codigos_generales)} generales)")

    resultados: list[dict] = []

    for codigo in todos_codigos:
        try:
            sess = BannerSession()
            sess.login()

            secciones = sess.search(codigo)
            if not secciones:
                sess.close()
                continue

            # Verificar que el resultado corresponde al código buscado
            primer = secciones[0]
            codigo_resp = f"{primer.get('subject','')}{primer.get('courseNumber','')}"
            if codigo_resp != codigo:
                sess.close()
                continue

            # Filtrar solo Campus Coto
            coto = [s for s in secciones if "Campus Coto" in (s.get("campusDescription") or "")]
            if not coto:
                sess.close()
                continue

            for sec in coto:
                resultados.append(_ensamblar_seccion(sec, codigo))

            log.info(f"  ✓ {codigo}: {len(coto)} sección(es) Campus Coto")
            sess.close()
            time.sleep(0.5)

        except Exception as e:
            log.warning(f"  ⚠ {codigo}: {e}")

    log.info(f"  Total {sigla}: {len(resultados)} secciones\n")
    return resultados


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("Sprint 2 — Banner Connector (Campus Coto)")
    log.info("=" * 60)

    total = 0
    for sigla, subjects in SUBJECTS_POR_CARRERA.items():
        secciones = extraer_carrera(sigla, subjects)
        if secciones:
            ruta = OUTPUT_RAW_DIR / f"banner_{sigla}_{TERM_CODE}.json"
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(secciones, f, ensure_ascii=False, indent=2)
            log.info(f"  ✓ {ruta} ({len(secciones)} secciones)")
            total += len(secciones)
        else:
            log.warning(f"  ⚠ {sigla}: sin secciones")

    log.info(f"\n✓ COMPLETADO — {total} secciones totales")


if __name__ == "__main__":
    run()
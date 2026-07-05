# extractors/banner_connector.py
#
# Conector Banner — Student Registration SSB (UNA)
# Flujo: una sesión POR CADA CURSO
#
# Pasos por curso:
#   1. GET term/termSelection → token
#   2. POST term/search       → activar 202620
#   3. GET searchResults      → JSON completo (secciones + faculty + meetingsFaculty)
#   4. POST getRestrictions   → HTML con restricciones de programa por sección (NRC)
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
    BANNER_PROGRAM_TO_CARRERA,
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
SUBJECTS_BY_PROGRAM = {
    "isi":    ["EIF", "MAT", "LIX", "EGF", "EGC", "EGS", "EGA"],
    "itecad": ["TDC", "MAT", "LIX", "EGF", "EGC", "EGS", "EGA"],
    "topo":   ["TGF", "MAT", "LIX", "FIY", "EGF", "EGC", "EGS", "EGA"],
}

# Códigos de Estudios Generales confirmados en Campus Coto (diagnóstico exhaustivo)
GENERAL_CODES_COTO = [
    "EGF128", "EGC116", "EGS101", "EGS117", "EGS118", "EGS120", "EGA121"
]

# Mapa de campo booleano en meetingTime → nombre del día
_DAY_MAP = {
    "monday":    "Lunes",
    "tuesday":   "Martes",
    "wednesday": "Miércoles",
    "thursday":  "Jueves",
    "friday":    "Viernes",
    "saturday":  "Sábado",
    "sunday":    "Domingo",
}

# Set de subjects de Estudios Generales (única fuente de verdad)
_GENERAL_SUBJECTS = {"EGF", "EGC", "EGS", "EGA"}

_syllabus_codes_cache: dict[str, set[str]] | None = None


# ──────────────────────────────────────────────────────────────────────────────
# Parsers sobre el JSON de searchResults
# ──────────────────────────────────────────────────────────────────────────────

def _format_time(t: str | None) -> str:
    """'0800' → '08:00'. Descarta valores no numéricos o longitud != 4."""
    if not t or len(t) != 4 or not t.isdigit():
        return t or ""
    return f"{t[:2]}:{t[2:]}"


def _parse_schedules(meetings: list[dict]) -> list[dict]:
    """
    Devuelve una lista de bloques de horario.
    Cada bloque incluye día, inicio, fin y aula.
    Si un curso tiene teoría en un aula y laboratorio en otra,
    cada uno aparece como un bloque separado con su propia aula.
    """
    schedules = []
    for block in meetings:
        mt = block.get("meetingTime") or {}
        start = _format_time(mt.get("beginTime"))
        end   = _format_time(mt.get("endTime"))
        if not start or not end:
            continue
        building = mt.get("building") or mt.get("buildingDescription") or ""
        room     = mt.get("room") or ""
        classroom = f"{building}-{room}".strip("-")
        for field, name in _DAY_MAP.items():
            if mt.get(field):
                schedules.append({
                    "day":       name,
                    "start":     start,
                    "end":       end,
                    "classroom": classroom,
                })
    return schedules


def _parse_instructor(faculty: list[dict]) -> str:
    """
    Nombre del instructor primario; si no hay primario, el primero.
    Blindado contra displayName ausente o de tipo inesperado.
    """
    if not faculty:
        return ""
    primary = next((f for f in faculty if f.get("primaryIndicator")), faculty[0])
    name = primary.get("displayName") or ""
    return unescape(str(name))


def _parse_credits(sec: dict) -> int | float | str:
    """
    Extrae créditos del JSON.
    Si creditHourLow != creditHourHigh, devuelve string "low-high".
    """
    low = sec.get("creditHourLow")
    high = sec.get("creditHourHigh")
    if low is not None and high is not None and low != high:
        return f"{low}-{high}"
    return low or high or sec.get("creditHours") or sec.get("numberOfUnits") or 0


def _parse_dates(meetings: list[dict]) -> tuple[str, str]:
    """Extrae fecha_inicio y fecha_fin del primer bloque de reunión."""
    if not meetings:
        return "", ""
    mt = meetings[0].get("meetingTime") or {}
    return mt.get("startDate") or "", mt.get("endDate") or ""


def _is_general_subject(code: str) -> bool:
    """
    Verifica si un código de curso pertenece a Estudios Generales.
    Acepta tanto el código completo (EGF128) como solo el prefijo (EGF).
    """
    prefix = code[:3] if len(code) >= 3 else code
    return prefix in _GENERAL_SUBJECTS


# ──────────────────────────────────────────────────────────────────────────────
# Parser de restricciones (getRestrictions)
# ──────────────────────────────────────────────────────────────────────────────

def _parse_restrictions(html: str) -> list[str]:
    """
    Extrae los códigos de programa permitidos desde el HTML devuelto por
    getRestrictions.

    El HTML tiene un bloque "Must be enrolled in one of the following
    Programs:" (inglés) o "Debe ingresarse en uno de los siguientes
    programas:" (español), seguido de uno o más
    <span class="detail-popup-indentation"> con el nombre largo y el
    código entre paréntesis, ej.:

        <span class="status-bold">Must be enrolled in one of the
        following Programs: </span><br/>
            <span class="detail-popup-indentation">Ba. Ing Tec Comp
            Ciencia Datos (BA-TECOMCD)</span><br/>

    Nota: Banner UNA puede devolver este HTML en inglés o español según
    la sesión. El regex soporta ambos idiomas.

    Devuelve una lista de códigos, ej. ["BA-TECOMCD"].
    Si el bloque de programas no aparece, devuelve [].
    """
    if not html:
        return []

    # Buscar el bloque de programas (inglés o español) hasta el próximo
    # <br/><br/> o cierre de </div>. Case-insensitive.
    m = re.search(
        r"(?:siguientes\s+programas|following\s+Programs)\s*:.*?</span>\s*<br\s*/?>"
        r"(.*?)(?:<br\s*/?>\s*<br\s*/?>|</div>)",
        html, re.I | re.S,
    )
    if not m:
        return []

    block = m.group(1)
    codes = re.findall(r"\(([A-Z0-9-]+)\)", block)
    return codes


# ──────────────────────────────────────────────────────────────────────────────
# Ensamblado de sección (función extraída para testeo aislado)
# ──────────────────────────────────────────────────────────────────────────────

def _build_section(sec: dict, code: str, banner_program: str | None = None) -> dict:
    """
    Convierte un dict de sección del JSON de Banner en el formato
    normalizado de salida del ETL.

    banner_program: sigla interna de carrera (ej. "itecad") obtenida al
    traducir el código de programa de getRestrictions con
    BANNER_PROGRAM_TO_CARRERA. Se guarda en "metadata" (columna JSONB
    ya existente desde V3). None si no se pudo determinar.
    """
    crn       = sec.get("courseReferenceNumber", "")
    meetings  = sec.get("meetingsFaculty") or []
    faculty   = sec.get("faculty") or []
    start_date, end_date = _parse_dates(meetings)

    return {
        "crn":       crn,
        "course":    code,
        "title":     unescape(sec.get("courseTitle") or ""),
        "credits":   _parse_credits(sec),
        "campus":    unescape(sec.get("campusDescription") or ""),
        "type":      unescape(sec.get("scheduleTypeDescription") or ""),
        "section":   sec.get("sequenceNumber") or "",
        "capacity":     sec.get("maximumEnrollment") or 0,
        "enrolled":     sec.get("enrollment") or 0,
        "available":    sec.get("seatsAvailable") or 0,
        "instructor":   _parse_instructor(faculty),
        "schedules":    _parse_schedules(meetings),
        "start_date":   start_date,
        "end_date":     end_date,
        "is_general":   _is_general_subject(code),
        "metadata": {
            "banner_program": banner_program,
        },
    }


# ──────────────────────────────────────────────────────────────────────────────
# BannerSession — una sesión efímera por curso
# ──────────────────────────────────────────────────────────────────────────────

def _generate_id() -> str:
    import random, string
    chars = string.ascii_lowercase + string.digits
    return f"{''.join(random.choices(chars, k=5))}{int(time.time() * 1000)}"


def _extract_token(html: str) -> str:
    patterns = [
        r'<meta\s+name="synchronizerToken"\s+content="([^"]+)"',
        r'<input[^>]+name="synchronizerToken"[^>]+value="([^"]+)"',
        r'"synchronizerToken"\s*:\s*"([^"]+)"',
        r"synchronizerToken['\"]?\s*[=:]\s*['\"]([^'\"]+)",
    ]
    for pat in patterns:
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

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        for attempt in range(1, MAX_RETRY_ATTEMPTS + 1):
            try:
                resp = self.session.request(
                    method, url, timeout=REQUEST_TIMEOUT_SECONDS, **kwargs
                )
                if resp.status_code in (429, 500, 502, 503):
                    t = RETRY_BACKOFF_FACTOR ** attempt
                    log.debug(f"HTTP {resp.status_code} — retry {attempt} in {t:.1f}s")
                    time.sleep(t)
                    continue
                resp.raise_for_status()
                return resp
            except requests.RequestException as e:
                if attempt == MAX_RETRY_ATTEMPTS:
                    raise
                time.sleep(RETRY_BACKOFF_FACTOR ** attempt)

    def login(self) -> None:
        r = self._request("GET", f"{BANNER_BASE}/term/termSelection?mode=courseSearch")
        self._token = _extract_token(r.text)
        self._uid   = _generate_id()
        self._request(
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

    def search(self, code: str) -> list[dict]:
        r = self._request(
            "GET", f"{BANNER_BASE}/searchResults/searchResults",
            params={
                "txt_subjectcoursecombo": code,
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

    def get_restrictions(self, crn: str) -> str:
        """
        POST a searchResults/getRestrictions.
        Devuelve el HTML crudo con las restricciones de la sección
        (campus, programa, etc.) para el CRN dado. Se parsea aparte con
        _parse_restrictions().

        Body confirmado por inspección de Network (04/jul/2026):
            term=202620
            courseReferenceNumber=<crn>
        Reutiliza la misma sesión/token que login()/search(); no requiere
        una sesión nueva.
        """
        r = self._request(
            "POST", f"{BANNER_BASE}/searchResults/getRestrictions",
            data={
                "term": TERM_CODE,
                "courseReferenceNumber": crn,
            },
            headers={
                "x-synchronizer-token": self._token,
                "x-requested-with":     "XMLHttpRequest",
                "accept":               "*/*",
                "content-type":         "application/x-www-form-urlencoded; charset=UTF-8",
                "referer": f"{BANNER_BASE}/courseSearch/courseSearch",
            },
        )
        return r.text

    def close(self):
        self.session.close()


# ──────────────────────────────────────────────────────────────────────────────
# Extracción por carrera
# ──────────────────────────────────────────────────────────────────────────────

def _load_syllabus_codes(force_reload: bool = False) -> dict[str, set[str]]:
    """
    Carga los códigos de curso desde la malla normalizada.
    Cachea el resultado. Usar force_reload=True para invalidar caché.
    """
    global _syllabus_codes_cache
    if _syllabus_codes_cache is not None and not force_reload:
        return _syllabus_codes_cache
    path = Path("output/normalized/syllabi_normalized.json")
    with open(path, encoding="utf-8") as f:
        courses = json.load(f)
    codes: dict[str, set[str]] = defaultdict(set)
    for c in courses:
        codes[c["carrera_sigla"]].add(c["codigo"])
    _syllabus_codes_cache = dict(codes)
    return _syllabus_codes_cache


def extract_program(program: str, subjects: list[str]) -> list[dict]:
    syllabus_codes = _load_syllabus_codes().get(program, set())

    # Separar subjects regulares de generales
    regular_subjects = [s for s in subjects if not _is_general_subject(s)]
    general_subjects = [s for s in subjects if _is_general_subject(s)]

    # Códigos regulares: de la malla
    codes = sorted(c for c in syllabus_codes if any(c.startswith(s) for s in regular_subjects))

    # Códigos generales: lista fija ya diagnosticada
    general_codes = GENERAL_CODES_COTO if general_subjects else []

    all_codes = codes + general_codes
    log.info(f"▶ {program}: {len(all_codes)} códigos ({len(codes)} malla + {len(general_codes)} generales)")

    results: list[dict] = []

    for code in all_codes:
        try:
            sess = BannerSession()
            sess.login()

            sections = sess.search(code)
            if not sections:
                sess.close()
                continue

            # Verificar que el resultado corresponde al código buscado
            first = sections[0]
            response_code = f"{first.get('subject','')}{first.get('courseNumber','')}"
            if response_code != code:
                sess.close()
                continue

            # Filtrar solo Campus Coto
            coto = [s for s in sections if "Campus Coto" in (s.get("campusDescription") or "")]
            if not coto:
                sess.close()
                continue

            for sec in coto:
                crn = sec.get("courseReferenceNumber", "")
                banner_program = None
                if crn:
                    try:
                        html_restrictions = sess.get_restrictions(crn)
                        restriction_codes = _parse_restrictions(html_restrictions)
                        # Tomar el primer código que matchee con nuestro mapeo.
                        # Si hay varios (raro), el primero que esté en el mapeo gana.
                        for rc in restriction_codes:
                            mapped = BANNER_PROGRAM_TO_CARRERA.get(rc)
                            if mapped:
                                banner_program = mapped
                                break
                    except Exception as e:
                        log.warning(f"    ⚠ getRestrictions CRN {crn}: {e}")
                    time.sleep(0.2)
                # Solo incluir la sección si la carrera de Banner coincide
                # explícitamente con la carrera que estamos extrayendo.
                # Si banner_program es None (no se pudo determinar o es de
                # una carrera fuera de nuestro mapeo), se omite.
                if banner_program == program:
                    results.append(_build_section(sec, code, banner_program))
                elif banner_program is None:
                    log.debug(f"    ↳ {code} CRN {crn}: sin carrera determinada, omitiendo")
                else:
                    log.debug(f"    ↳ {code} CRN {crn}: banner_program={banner_program} ≠ {program}, omitiendo")

            log.info(f"  ✓ {code}: {len(coto)} sección(es) Campus Coto")
            sess.close()
            time.sleep(0.5)

        except Exception as e:
            log.warning(f"  ⚠ {code}: {e}")

    log.info(f"  Total {program}: {len(results)} secciones\n")
    return results


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("Sprint 2 — Banner Connector (Campus Coto)")
    log.info("=" * 60)

    total = 0
    for program, subjects in SUBJECTS_BY_PROGRAM.items():
        sections = extract_program(program, subjects)
        if sections:
            path = OUTPUT_RAW_DIR / f"banner_{program}_{TERM_CODE}.json"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(sections, f, ensure_ascii=False, indent=2)
            log.info(f"  ✓ {path} ({len(sections)} secciones)")
            total += len(sections)
        else:
            log.warning(f"  ⚠ {program}: sin secciones")

    log.info(f"\n✓ COMPLETADO — {total} secciones totales")


if __name__ == "__main__":
    run()
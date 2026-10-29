# extractors/terms.py
"""
Períodos (ciclos lectivos) de Banner: única fuente de verdad del ETL.

- describe_term: código YYYYNN -> (año, ciclo, nombre), con el mapa de
  sufijos explícito de config.TERM_SUFFIXES.
- discover_terms: qué períodos hay que extraer hoy, sin depender de un
  ciclo hardcodeado.

Por qué no alcanza con classSearch/getTerms: verificado el 28/oct/2026,
getTerms NO lista 202695 ni 202710, pero term/search + searchResults sí
devuelven sus secciones. Por eso se prueban códigos candidatos contra
searchResults (txt_campus=BC). getTerms se usa solo para saber qué
períodos están cerrados: su descripción trae "(View Only)" o, según el
idioma de la sesión, "(Sólo ver)".
"""

import logging
import re
import time
from dataclasses import dataclass
from datetime import date
from typing import Callable, Iterable

import requests

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import (
    BANNER_BASE_URL,
    BANNER_GET_TERMS_PATH,
    BANNER_SEARCH_RESULTS_PATH,
    BANNER_CAMPUS_COTO_CODE,
    REQUEST_TIMEOUT_SECONDS,
    TERM_SUFFIXES,
)

log = logging.getLogger(__name__)

_TERM_CODE_RE = re.compile(r"^\d{4}\d{2}$")
_VIEW_ONLY_RE = re.compile(r"\((?:view\s+only|s[oó]lo\s+ver)\)", re.IGNORECASE)


class UnknownTermSuffixError(ValueError):
    """Código de período con un sufijo fuera de TERM_SUFFIXES (ej. 202630)."""


def describe_term(code: str) -> tuple[int, int, str]:
    """
    '202620' -> (2026, 2, 'Ciclo II 2026'); '202695' -> (2026, 3,
    'Ciclo III (Verano) 2026'). Sufijo desconocido o formato inválido ->
    UnknownTermSuffixError: nunca se adivina un ciclo.
    """
    if not isinstance(code, str) or not _TERM_CODE_RE.match(code):
        raise UnknownTermSuffixError(f"Código de período inválido: {code!r} (se espera YYYYNN)")
    suffix = code[4:]
    if suffix not in TERM_SUFFIXES:
        raise UnknownTermSuffixError(
            f"Sufijo de período desconocido '{suffix}' en {code} "
            f"(soportados: {', '.join(sorted(TERM_SUFFIXES))})"
        )
    cycle, label = TERM_SUFFIXES[suffix]
    year = int(code[:4])
    return year, cycle, f"{label} {year}"


def is_view_only(description: str | None) -> bool:
    """True si getTerms marca el período como cerrado (solo consulta)."""
    return bool(description and _VIEW_ONLY_RE.search(description))


def candidate_terms(today: date, active_in_db: Iterable[str]) -> list[str]:
    """
    (año actual + siguiente) × sufijos soportados, más los períodos que ya
    están activos en la BD -- así un verano que sigue en curso en enero
    (202695 en ene/2027) se sigue re-evaluando aunque ya no sea del "año
    actual". Ordenados cronológicamente.
    """
    codes = {f"{year}{suffix}" for year in (today.year, today.year + 1) for suffix in TERM_SUFFIXES}
    codes.update(active_in_db)
    return sorted(codes, key=int)


# ──────────────────────────────────────────────────────────────────────────────
# Llamadas a Banner (inyectables en los tests)
# ──────────────────────────────────────────────────────────────────────────────

def fetch_banner_terms(max_terms: int = 100) -> dict[str, str]:
    """GET classSearch/getTerms -> {codigo: descripcion}. No requiere sesión."""
    resp = requests.get(
        f"{BANNER_BASE_URL}{BANNER_GET_TERMS_PATH}",
        params={"searchTerm": "", "offset": 1, "max": max_terms},
        headers={"Accept": "application/json"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    return {t["code"]: t.get("description", "") for t in resp.json()}


def count_coto_sections(term: str) -> int:
    """
    Cantidad de secciones del Campus Coto que Banner publica para un
    período (searchResults con txt_campus=BC, solo se lee totalCount).
    """
    from extractors.banner_connector import BannerSession  # import diferido: evita ciclo

    session = BannerSession(term)
    try:
        session.login()
        resp = session._request(
            "GET", f"{BANNER_BASE_URL}{BANNER_SEARCH_RESULTS_PATH}",
            params={
                "txt_term": term,
                "txt_campus": BANNER_CAMPUS_COTO_CODE,
                "pageOffset": 0,
                "pageMaxSize": 1,
                "sortColumn": "subjectDescription",
                "sortDirection": "asc",
                "uniqueSessionId": session.unique_id,
                "_": int(time.time() * 1000),
            },
            headers=session.ajax_headers(),
        )
        data = resp.json()
        return int(data.get("totalCount") or 0) if data.get("success") else 0
    finally:
        session.close()


# ──────────────────────────────────────────────────────────────────────────────
# Descubrimiento
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class TermStatus:
    """Lo que el ETL sabe de un período en esta corrida."""
    code: str
    listed: bool          # aparece en getTerms
    view_only: bool       # getTerms lo marca "(View Only)"/"(Sólo ver)"
    coto_sections: int | None  # None = no se probó (override o view only)

    @property
    def extract(self) -> bool:
        """Se extrae si no está cerrado y (se forzó o Banner tiene secciones)."""
        return not self.view_only and (self.coto_sections is None or self.coto_sections > 0)


# ──────────────────────────────────────────────────────────────────────────────
# Regla de periodo.activo (única en el ETL)
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class PeriodState:
    """Estado de un período en la BD tras cargar sus secciones."""
    code: str
    active: bool               # periodo.activo actual
    view_only: bool            # getTerms lo marca cerrado
    section_count: int         # secciones del período en la BD
    max_end_date: date | None  # MAX(seccion.fecha_fin) del período


@dataclass
class ActiveDecision:
    code: str
    active: bool
    reason: str
    warning: str | None = None


def decide_active(states: list[PeriodState], today: date) -> list[ActiveDecision]:
    """
    periodo.activo = "visible/seleccionable en SIHA". Por período:
    - "(View Only)"/"(Sólo ver)" en getTerms -> inactivo.
    - hoy > MAX(seccion.fecha_fin) -> inactivo (el ciclo ya terminó).
    - sin secciones en la BD -> se deja como está (regla de 0 secciones:
      un período nuevo no se activa; uno activo no se apaga por un
      Banner vacío).
    - con secciones y sin fechas -> activo + WARNING.
    - con secciones y fechas vigentes -> activo.

    Invariante: nunca dejar 0 períodos activos. Si las desactivaciones de
    esta corrida lo provocarían, no se aplican (+ WARNING). `states` debe
    incluir TODOS los períodos activos de la BD (candidate_terms ya los
    agrega), si no el invariante no se puede verificar.
    """
    decisions: list[ActiveDecision] = []
    for st in states:
        if st.view_only:
            decisions.append(ActiveDecision(st.code, False, "getTerms lo marca cerrado (View Only)"))
        elif st.max_end_date is not None and today > st.max_end_date:
            decisions.append(ActiveDecision(st.code, False, f"terminó el {st.max_end_date.isoformat()}"))
        elif st.section_count == 0:
            decisions.append(ActiveDecision(
                st.code, st.active, "sin secciones en la BD, se mantiene",
                warning=f"{st.code}: 0 secciones en la BD, activo se deja en {st.active}"
                if st.active else None,
            ))
        elif st.max_end_date is None:
            decisions.append(ActiveDecision(
                st.code, True, "con secciones, sin fechas",
                warning=f"{st.code}: ninguna sección trae fecha_fin, se deja activo sin poder saber cuándo termina",
            ))
        else:
            decisions.append(ActiveDecision(st.code, True, f"vigente hasta {st.max_end_date.isoformat()}"))

    if not any(d.active for d in decisions):
        for d, st in zip(decisions, states):
            if st.active and not d.active:
                d.active = True
                d.warning = (
                    f"{d.code}: no se desactiva ({d.reason}) porque dejaría 0 períodos activos"
                )
                d.reason = "se mantiene activo por el invariante de >=1 activo"
    return decisions


def parse_override(value: str | None) -> list[str]:
    """CICLOS='202620, 202695' -> ['202620', '202695'] (validados)."""
    if not value or not value.strip():
        return []
    codes = [c.strip() for c in value.split(",") if c.strip()]
    for c in codes:
        describe_term(c)  # sufijo desconocido -> error explícito
    return sorted(set(codes), key=int)


def discover_terms(
    today: date,
    active_in_db: Iterable[str],
    override: list[str] | None = None,
    fetch_terms: Callable[[], dict[str, str]] = fetch_banner_terms,
    count_sections: Callable[[str], int] = count_coto_sections,
) -> list[TermStatus]:
    """
    Estado de cada período candidato. Con override (CICLOS), se usan esos
    códigos sin probar secciones, pero igual se respeta "(View Only)": un
    período cerrado nunca se extrae ni se activa.
    """
    banner_terms = fetch_terms()
    codes = override if override else candidate_terms(today, active_in_db)

    statuses: list[TermStatus] = []
    for code in codes:
        describe_term(code)
        description = banner_terms.get(code)
        status = TermStatus(
            code=code,
            listed=description is not None,
            view_only=is_view_only(description),
            coto_sections=None,
        )
        if status.view_only:
            log.info(f"  {code}: '{description}' -> cerrado, no se extrae")
        elif not override:
            status.coto_sections = count_sections(code)
            log.info(
                f"  {code}: {status.coto_sections} secciones Coto en Banner"
                f"{'' if status.listed else ' (no listado en getTerms)'}"
            )
        else:
            log.info(f"  {code}: forzado por CICLOS")
        statuses.append(status)
    return statuses

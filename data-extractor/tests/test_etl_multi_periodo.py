# tests/test_etl_multi_periodo.py
"""
Tests del ETL multi-período.

- Unitarios: describe_term, detección de períodos cerrados, descubrimiento
  (getTerms y searchResults mockeados), regla de periodo.activo y parser de
  fechas de Banner con una sección real capturada.
- Integración contra la BD real (Docker local horarios-db): upsert de
  sección, reemplazo de horarios, regla de 0 secciones y marca 'agotada'
  acotada por (período, carrera). Cada test corre dentro de una
  transacción que se revierte al final, aunque el test falle -- no deja
  datos en la BD. Si la BD no está disponible, se saltan.
"""

import json
import logging
import sys
from datetime import date
from pathlib import Path

import psycopg2
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from extractors import populate_db
from extractors.banner_connector import _build_section
from extractors.terms import (
    PeriodState,
    TermStatus,
    UnknownTermSuffixError,
    candidate_terms,
    decide_active,
    describe_term,
    discover_terms,
    is_view_only,
    parse_override,
)

FIXTURES = Path(__file__).parent / "fixtures"


# ──────────────────────────────────────────────────────────────────────────────
# describe_term
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("code, expected", [
    ("202610", (2026, 1, "Ciclo I 2026")),
    ("202620", (2026, 2, "Ciclo II 2026")),
    ("202695", (2026, 3, "Ciclo III (Verano) 2026")),
    ("202710", (2027, 1, "Ciclo I 2027")),
])
def test_describe_term_sufijos_soportados(code, expected):
    assert describe_term(code) == expected


@pytest.mark.parametrize("code", ["202630", "202600", "202613", "202625", "202605"])
def test_describe_term_sufijo_desconocido_es_error_explicito(code):
    # 30 NO es el verano (es 95); 00/03/05/13/15/23/25 son anual/cuatri/trimestres.
    with pytest.raises(UnknownTermSuffixError, match="Sufijo"):
        describe_term(code)


@pytest.mark.parametrize("code", ["2026", "20262O", "", "2026200"])
def test_describe_term_formato_invalido(code):
    with pytest.raises(UnknownTermSuffixError):
        describe_term(code)


# ──────────────────────────────────────────────────────────────────────────────
# Períodos cerrados en getTerms
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("description, expected", [
    ("CICLO I 2026 (View Only)", True),   # lo que devuelve hoy getTerms sin sesión
    ("CICLO I 2026 (Sólo ver)", True),    # sesión en español
    ("CICLO I 2026 (Solo ver)", True),
    ("CICLO II 2026", False),
    ("", False),
    (None, False),
])
def test_is_view_only(description, expected):
    assert is_view_only(description) is expected


# ──────────────────────────────────────────────────────────────────────────────
# Descubrimiento
# ──────────────────────────────────────────────────────────────────────────────

# Respuesta real de getTerms del 28/oct/2026 (recortada): 202695 y 202710
# NO aparecen, 202610 está cerrado.
GET_TERMS_REAL = {
    "202625": "TRIMESTRE III 2026",
    "202620": "CICLO II 2026",
    "202615": "TRIMESTRE II 2026 (View Only)",
    "202610": "CICLO I 2026 (View Only)",
    "202595": "CICLO III (VERANO) 2025 (View Only)",
}
# Secciones Coto por período verificadas ese día (txt_campus=BC).
SECCIONES_COTO = {"202620": 70, "202695": 17, "202710": 84}


def test_candidate_terms_incluye_activos_de_la_bd():
    # En enero 2027, el verano 2026 sigue en curso: aunque ya no es del año
    # actual, debe seguir evaluándose porque está activo en la BD.
    codes = candidate_terms(date(2027, 1, 15), ["202695"])
    assert "202695" in codes
    assert {"202710", "202720", "202795", "202810", "202820", "202895"} <= set(codes)
    assert codes == sorted(codes, key=int)


def test_discover_terms_filtra_view_only_y_prueba_candidatos():
    probados = []

    def count(code):
        probados.append(code)
        return SECCIONES_COTO.get(code, 0)

    statuses = discover_terms(
        date(2026, 10, 28), ["202620"],
        fetch_terms=lambda: GET_TERMS_REAL, count_sections=count,
    )
    by_code = {st.code: st for st in statuses}

    assert [st.code for st in statuses if st.extract] == ["202620", "202695", "202710"]
    assert by_code["202610"].view_only and not by_code["202610"].extract
    assert "202610" not in probados  # un período cerrado ni se consulta
    assert by_code["202695"].listed is False  # descubierto aunque getTerms no lo liste
    assert by_code["202720"].coto_sections == 0 and not by_code["202720"].extract


def test_discover_terms_override_salta_el_descubrimiento_pero_respeta_view_only():
    def count(code):
        raise AssertionError("con CICLOS no se prueban secciones")

    statuses = discover_terms(
        date(2026, 10, 28), ["202620"], override=parse_override("202620, 202610"),
        fetch_terms=lambda: GET_TERMS_REAL, count_sections=count,
    )
    assert [st.code for st in statuses] == ["202610", "202620"]
    assert [st.code for st in statuses if st.extract] == ["202620"]


def test_parse_override_sufijo_desconocido_es_error():
    with pytest.raises(UnknownTermSuffixError):
        parse_override("202620,202630")
    assert parse_override("") == []
    assert parse_override(None) == []


# ──────────────────────────────────────────────────────────────────────────────
# Regla de periodo.activo
# ──────────────────────────────────────────────────────────────────────────────

HOY = date(2026, 10, 28)


def _st(code, active=True, view_only=False, count=10, end=date(2026, 11, 14)):
    return PeriodState(code, active, view_only, count, end)


def test_decide_active_reglas_basicas():
    decisions = {d.code: d for d in decide_active([
        _st("202610", view_only=True),                       # cerrado en getTerms
        _st("202620"),                                       # vigente
        _st("202595", end=date(2026, 2, 20)),                # ya terminó
        _st("202695", active=False, end=None),               # nuevo, sin fechas
        _st("202720", active=False, count=0, end=None),      # nuevo, sin secciones
        _st("202710", active=True, count=0, end=None),       # activo, Banner vacío
    ], HOY)}

    assert decisions["202610"].active is False
    assert decisions["202620"].active is True
    assert decisions["202595"].active is False
    assert decisions["202695"].active is True and decisions["202695"].warning
    assert decisions["202720"].active is False      # no se activa sin secciones
    assert decisions["202710"].active is True       # 0 secciones no lo apaga
    assert decisions["202710"].warning


def test_decide_active_nunca_deja_cero_activos():
    decisions = decide_active([
        _st("202620", end=date(2026, 10, 1)),   # terminó
        _st("202610", view_only=True),          # cerrado
    ], HOY)
    assert [d.active for d in decisions] == [True, True]
    assert all("0 períodos activos" in d.warning for d in decisions)


def test_decide_active_invariante_no_bloquea_si_queda_otro_activo():
    decisions = {d.code: d for d in decide_active([
        _st("202620", end=date(2026, 10, 1)),
        _st("202695", active=False),
    ], HOY)}
    assert decisions["202620"].active is False
    assert decisions["202695"].active is True


# ──────────────────────────────────────────────────────────────────────────────
# Fechas de Banner (MM/DD/YYYY) con una sección real capturada
# ──────────────────────────────────────────────────────────────────────────────

def _real_section() -> dict:
    raw = json.loads((FIXTURES / "banner_seccion_202620.json").read_text(encoding="utf-8"))
    code = raw["subject"] + raw["courseNumber"]
    return _build_section(raw, code, "adm")


def _fechas(start, end):
    return {"crn": "51051", "start_date": start, "end_date": end}


def test_fecha_real_de_banner_es_valida_como_mes_dia_anio():
    sec = _real_section()
    assert sec["start_date"] == "07/20/2026"
    dates = populate_db._validate_section_dates(sec, "202620")
    assert dates.valid
    assert (dates.start, dates.end) == (date(2026, 7, 20), date(2026, 11, 14))


@pytest.mark.parametrize("start, end, term, motivo", [
    # Formato DD/MM no ambiguo (día > 12): no parsea como MM/DD.
    ("20/07/2026", "14/11/2026", "202620", "formato"),
    # Ambigua en DD/MM: 08/03/2027 (8 de marzo) leída como MM/DD = 3 de
    # agosto, posterior al fin -> se detecta por inicio >= fin.
    ("08/03/2027", "03/07/2027", "202710", "no es anterior"),
    # Año incoherente con el período.
    ("07/20/2025", "11/14/2025", "202620", "año fuera"),
    # El Ciclo I no puede caer en el año siguiente (solo el verano).
    ("03/08/2028", "07/03/2028", "202710", "año fuera"),
    ("2026-07-20", "2026-11-14", "202620", "formato"),
])
def test_fechas_invalidas_se_detectan(start, end, term, motivo):
    dates = populate_db._validate_section_dates(_fechas(start, end), term)
    assert not dates.valid and not dates.missing
    assert motivo in dates.problem


def test_fecha_ambigua_en_mes_dia_es_valida():
    # 03/08/2027 en MM/DD = 8 de marzo: el formato real de Banner para 202710.
    dates = populate_db._validate_section_dates(_fechas("03/08/2027", "07/03/2027"), "202710")
    assert dates.valid
    assert (dates.start, dates.end) == (date(2027, 3, 8), date(2027, 7, 3))


def test_verano_puede_caer_en_el_anio_siguiente():
    # 202695 corre del 4 de enero al 27 de febrero de 2027.
    assert populate_db._validate_section_dates(_fechas("01/04/2027", "02/27/2027"), "202695").valid
    assert populate_db._validate_section_dates(_fechas("12/14/2026", "02/27/2027"), "202695").valid


def test_seccion_sin_fechas_se_reporta_como_faltante():
    dates = populate_db._validate_section_dates(_fechas("", None), "202710")
    assert dates.missing and not dates.valid


def test_decide_active_no_desactiva_por_fecha_si_las_fechas_no_son_confiables():
    [d] = decide_active([
        PeriodState("202620", True, False, 10, date(2026, 11, 14), dates_trusted=False),
    ], date(2026, 11, 15))
    assert d.active is True and "umbral" in d.warning


# ──────────────────────────────────────────────────────────────────────────────
# Integración con la BD (transacción revertida en cada test)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def conn():
    try:
        connection = populate_db._connect(connect_timeout=3)
    except psycopg2.Error as e:
        pytest.skip(f"BD local no disponible: {e}")
    connection.autocommit = False
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


def _section(nrc, schedules=None, start="07/20/2099", end="11/14/2099", title="Curso de prueba", program="isi"):
    return {
        "crn": nrc, "course": "TST100", "title": title, "credits": 3,
        "campus": "SRB: Campus Coto", "type": "Teórico", "section": "01",
        "capacity": 30, "enrolled": 10, "available": 20,
        "instructor": "", "instructor_email": None,
        "schedules": schedules if schedules is not None else [
            {"day": "Lunes", "start": "08:00", "end": "09:40", "classroom": "A1"}
        ],
        "start_date": start, "end_date": end, "is_general": False,
        "metadata": {"banner_program": program},
    }


def _extraction(by_program, failed=None):
    failed = failed or {}
    return {p: {"sections": secs, "failed_codes": failed.get(p, [])} for p, secs in by_program.items()}


def _rows(conn, sql, params=()):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def _estado(conn, term, nrc):
    return _rows(conn, """
        SELECT s.estado_oferta FROM seccion s JOIN periodo p USING (id_periodo)
        WHERE p.codigo = %s AND s.nrc = %s""", (term, nrc))[0][0]


def test_insert_term_nace_inactivo_y_con_nombre_del_mapa(conn):
    populate_db._insert_term(conn, "209995")
    assert _rows(conn, "SELECT nombre, anio, ciclo, activo FROM periodo WHERE codigo = '209995'") == [
        ("Ciclo III (Verano) 2099", 2099, 3, False)
    ]


def test_upsert_actualiza_fechas_y_titulo_de_secciones_existentes(conn):
    pid = populate_db._insert_term(conn, "209910")
    populate_db._load_term_sections(conn, pid, "209910", _extraction({"isi": [_section("99001", start="", end="")]}))
    populate_db._load_term_sections(conn, pid, "209910", _extraction({"isi": [_section("99001", title="Nuevo título")]}))

    assert _rows(conn, "SELECT fecha_inicio, fecha_fin, titulo FROM seccion WHERE id_periodo = %s", (pid,)) == [
        (date(2099, 7, 20), date(2099, 11, 14), "Nuevo título")
    ]


def test_horarios_se_reemplazan_en_cada_corrida(conn):
    pid = populate_db._insert_term(conn, "209910")
    lunes = [{"day": "Lunes", "start": "08:00", "end": "09:40", "classroom": "A1"}]
    martes = [{"day": "Martes", "start": "13:00", "end": "14:40", "classroom": "B2"}]

    populate_db._load_term_sections(conn, pid, "209910", _extraction({"isi": [_section("99001", lunes)]}))
    populate_db._load_term_sections(conn, pid, "209910", _extraction({"isi": [_section("99001", martes)]}))

    bloques = _rows(conn, """
        SELECT b.dia, b.hora_inicio::text, b.aula FROM horario_bloque b
        JOIN seccion s USING (id_seccion) WHERE s.id_periodo = %s""", (pid,))
    assert bloques == [("Martes", "13:00:00", "B2")]


def test_seccion_sin_horarios_conserva_los_existentes(conn, caplog):
    pid = populate_db._insert_term(conn, "209910")
    populate_db._load_term_sections(conn, pid, "209910", _extraction({"isi": [_section("99001")]}))
    with caplog.at_level(logging.WARNING):
        populate_db._load_term_sections(conn, pid, "209910", _extraction({"isi": [_section("99001", schedules=[])]}))

    assert "sin horarios" in caplog.text
    assert len(_rows(conn, """
        SELECT 1 FROM horario_bloque b JOIN seccion s USING (id_seccion)
        WHERE s.id_periodo = %s""", (pid,))) == 1


def test_agotada_acotada_por_periodo(conn):
    # Mismo NRC en dos períodos: que no venga en P1 no afecta a P2.
    p1 = populate_db._insert_term(conn, "209910")
    p2 = populate_db._insert_term(conn, "209920")
    populate_db._load_term_sections(conn, p1, "209910", _extraction({"isi": [_section("99001"), _section("99002")]}))
    populate_db._load_term_sections(conn, p2, "209920", _extraction({"isi": [_section("99001")]}))

    populate_db._load_term_sections(conn, p1, "209910", _extraction({"isi": [_section("99002")]}))

    assert _estado(conn, "209910", "99001") == "agotada"
    assert _estado(conn, "209910", "99002") == "activa"
    assert _estado(conn, "209920", "99001") == "activa"


def test_agotada_acotada_por_carrera(conn):
    p1 = populate_db._insert_term(conn, "209910")
    populate_db._load_term_sections(conn, p1, "209910", _extraction({
        "isi": [_section("99001")], "topo": [_section("99003", program="topo")],
    }))
    # Corrida que solo trae isi (sin 99001): topo no se toca.
    populate_db._load_term_sections(conn, p1, "209910", _extraction({"isi": [_section("99002")]}))

    assert _estado(conn, "209910", "99001") == "agotada"
    assert _estado(conn, "209910", "99003") == "activa"


def test_cero_secciones_no_marca_agotada(conn, caplog):
    p1 = populate_db._insert_term(conn, "209910")
    populate_db._load_term_sections(conn, p1, "209910", _extraction({"isi": [_section("99001")]}))

    with caplog.at_level(logging.WARNING):
        stats = populate_db._load_term_sections(conn, p1, "209910", _extraction({"isi": []}))

    assert _estado(conn, "209910", "99001") == "activa"
    assert stats.by_program["isi"].skipped_exhausted_reason
    assert "no se marca 'agotada'" in caplog.text


def test_codigos_fallidos_no_marcan_agotada(conn):
    p1 = populate_db._insert_term(conn, "209910")
    populate_db._load_term_sections(conn, p1, "209910", _extraction({"isi": [_section("99001"), _section("99002")]}))
    populate_db._load_term_sections(
        conn, p1, "209910", _extraction({"isi": [_section("99002")]}, failed={"isi": ["TST100"]})
    )
    assert _estado(conn, "209910", "99001") == "activa"


def test_apply_active_rule_activa_periodo_nuevo_con_secciones_vigentes(conn):
    p1 = populate_db._insert_term(conn, "209910")
    populate_db._load_term_sections(conn, p1, "209910", _extraction({"isi": [_section("99001")]}))
    populate_db._insert_term(conn, "209920")  # sin secciones: no se activa

    populate_db.apply_active_rule(conn, [
        TermStatus("209910", listed=False, view_only=False, coto_sections=1),
        TermStatus("209920", listed=False, view_only=False, coto_sections=0),
    ], HOY)

    assert dict(_rows(conn, "SELECT codigo, activo FROM periodo WHERE codigo LIKE '2099%%'")) == {
        "209910": True, "209920": False,
    }


def _secciones(n, start="07/20/2099", end="11/14/2099"):
    return [_section(f"98{i:03d}", start=start, end=end) for i in range(n)]


def _fechas_en_bd(conn, pid):
    return dict(_rows(conn, "SELECT nrc, fecha_inicio FROM seccion WHERE id_periodo = %s", (pid,)))


def test_umbral_de_fechas_invalidas_bloquea_el_periodo(conn, caplog):
    pid = populate_db._insert_term(conn, "209910")
    populate_db._load_term_sections(conn, pid, "209910", _extraction({"isi": _secciones(20)}))

    # Segunda corrida: 2 de 20 (10%) llegan en DD/MM; el resto con otra fecha válida.
    nuevas = _secciones(20, start="07/27/2099")
    for sec in nuevas[:2]:
        sec["start_date"], sec["end_date"] = "27/07/2099", "21/11/2099"
    with caplog.at_level(logging.WARNING):
        stats = populate_db._load_term_sections(conn, pid, "209910", _extraction({"isi": nuevas}))

    assert stats.dates_blocked
    assert (stats.dates_valid, stats.dates_invalid) == (18, 2)
    # Bloqueado: ni las válidas se actualizan, todas conservan la fecha previa.
    assert set(_fechas_en_bd(conn, pid).values()) == {date(2099, 7, 20)}
    assert "no se actualiza ninguna fecha" in caplog.text


def test_bajo_el_umbral_solo_la_seccion_invalida_conserva_su_fecha(conn):
    pid = populate_db._insert_term(conn, "209910")
    populate_db._load_term_sections(conn, pid, "209910", _extraction({"isi": _secciones(25)}))

    nuevas = _secciones(25, start="07/27/2099")
    nuevas[0]["start_date"], nuevas[0]["end_date"] = "27/07/2099", "21/11/2099"  # 1/25 = 4%
    stats = populate_db._load_term_sections(conn, pid, "209910", _extraction({"isi": nuevas}))

    assert not stats.dates_blocked
    fechas = _fechas_en_bd(conn, pid)
    assert fechas.pop("98000") == date(2099, 7, 20)
    assert set(fechas.values()) == {date(2099, 7, 27)}


def test_apply_active_rule_respeta_fechas_no_confiables(conn):
    pid = populate_db._insert_term(conn, "209910")
    populate_db._load_term_sections(conn, pid, "209910", _extraction({
        "isi": _secciones(3, start="01/10/2099", end="02/20/2099"),
    }))
    estado = [TermStatus("209910", listed=False, view_only=False, coto_sections=3)]

    populate_db.apply_active_rule(conn, estado, date(2099, 3, 1))  # se activa? no: ya terminó
    assert _rows(conn, "SELECT activo FROM periodo WHERE codigo = '209910'") == [(False,)]

    _rows(conn, "UPDATE periodo SET activo = true WHERE codigo = '209910' RETURNING 1")
    populate_db.apply_active_rule(conn, estado, date(2099, 3, 1), untrusted_dates={"209910"})
    assert _rows(conn, "SELECT activo FROM periodo WHERE codigo = '209910'") == [(True,)]


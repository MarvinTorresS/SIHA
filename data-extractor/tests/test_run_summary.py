# tests/test_run_summary.py
"""
Tests del resumen de corrida (extractors/run_summary.py + run_etl).

- Diferencia de conjuntos pura: nueva, agotada, reaparecida, horario
  publicado y primera carga.
- status / has_changes.
- run_etl escribe el resumen aunque falle la BD, la malla o un período
  (Banner y populate_db mockeados: no se toca ninguna BD ni la red).
- snapshot_term contra el Docker local, en una transacción revertida.
"""

import json
import logging
import sys
from datetime import date
from pathlib import Path

import psycopg2
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import run_etl
from extractors import populate_db, run_summary
from extractors.run_summary import (
    LogCounter,
    RunSummary,
    SectionState,
    compute_status,
    diff_term,
)
from extractors.terms import TermStatus


def _s(code="EIF200", estado="activa", blocks=1, name="Fundamentos de informática"):
    return SectionState(code, name, estado, blocks)


# ──────────────────────────────────────────────────────────────────────────────
# diff_term
# ──────────────────────────────────────────────────────────────────────────────

def test_seccion_nueva():
    d = diff_term({"1": _s()}, {"1": _s(), "2": _s("EIF201")})
    assert [r["nrc"] for r in d.new] == ["2"]
    assert d.new[0] == {"nrc": "2", "course_code": "EIF201", "course_name": "Fundamentos de informática"}
    assert not (d.exhausted or d.reappeared or d.schedule_published)
    assert d.first_load is False and d.has_changes


def test_seccion_pasa_a_agotada():
    d = diff_term({"1": _s(), "2": _s()}, {"1": _s(estado="agotada"), "2": _s()})
    assert [r["nrc"] for r in d.exhausted] == ["1"]
    assert not (d.new or d.reappeared)


def test_seccion_ya_agotada_no_cuenta_otra_vez():
    d = diff_term({"1": _s(estado="agotada")}, {"1": _s(estado="agotada")})
    assert not d.has_changes


def test_seccion_reaparece():
    d = diff_term({"1": _s(estado="agotada")}, {"1": _s(estado="activa")})
    assert [r["nrc"] for r in d.reappeared] == ["1"]
    assert not d.exhausted


def test_horario_publicado_por_primera_vez():
    d = diff_term({"1": _s(blocks=0), "2": _s(blocks=2)}, {"1": _s(blocks=1), "2": _s(blocks=3)})
    assert [r["nrc"] for r in d.schedule_published] == ["1"]  # 2 ya tenía horario


def test_seccion_nueva_con_horario_cuenta_solo_como_nueva():
    d = diff_term({"1": _s()}, {"1": _s(), "2": _s(blocks=2)})
    assert [r["nrc"] for r in d.new] == ["2"]
    assert d.schedule_published == []


def test_sin_cambios():
    snap = {"1": _s(), "2": _s(estado="agotada", blocks=0)}
    d = diff_term(snap, dict(snap))
    assert not d.has_changes and d.first_load is False


def test_primera_carga():
    after = {"1": _s(blocks=0), "2": _s(blocks=2), "3": _s(blocks=1)}
    d = diff_term({}, after)
    assert d.first_load is True
    assert d.sections_total == 3 and d.sections_with_schedule == 2
    assert len(d.new) == 3 and d.schedule_published == []


# ──────────────────────────────────────────────────────────────────────────────
# status / has_changes
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("fatal, loaded, failed, expected", [
    (None, 3, 0, "ok"),
    (None, 0, 0, "ok"),  # nada que cargar no es un fallo
    (None, 2, 1, "partial_failure"),
    (None, 0, 2, "failed"),  # fallaron todos
    ("db_unavailable", 0, 0, "failed"),
    ("unexpected", 3, 0, "failed"),  # excepción global aunque haya cargado
])
def test_compute_status(fatal, loaded, failed, expected):
    assert compute_status(fatal, loaded, failed) == expected


def _no_changes_diff():
    return diff_term({"1": _s()}, {"1": _s()})


def test_has_changes_false_si_nada_cambio():
    s = RunSummary()
    s.record_term("202620", "Ciclo II 2026", _no_changes_diff(), is_new=False)
    s.record_active_changes({"202620": True}, {"202620": True}, {})
    data = s.to_dict(0, None)
    assert data["has_changes"] is False and data["status"] == "ok"


def test_has_changes_por_cambio_de_activo():
    s = RunSummary()
    s.record_term("202620", "Ciclo II 2026", _no_changes_diff(), is_new=False)
    s.record_active_changes({"202620": True, "202710": False}, {"202620": False, "202710": True},
                            {"202620": "Ciclo II 2026", "202710": "Ciclo I 2027"})
    data = s.to_dict(0, None)
    assert data["has_changes"] is True
    assert data["active_changes"] == [
        {"code": "202620", "name": "Ciclo II 2026", "active": False},
        {"code": "202710", "name": "Ciclo I 2027", "active": True},
    ]


def test_periodo_nuevo_se_reporta():
    s = RunSummary()
    s.record_term("202710", "Ciclo I 2027", diff_term({}, {"9": _s()}), is_new=True)
    data = s.to_dict(0, None)
    assert data["new_terms"] == ["202710"] and data["has_changes"] is True


def test_log_counter():
    logger = logging.getLogger("test_log_counter")
    counter = LogCounter()
    logger.addHandler(counter)
    try:
        logger.info("info")
        logger.warning("w1")
        logger.warning("w2")
        logger.error("e")
        logger.critical("c")
    finally:
        logger.removeHandler(counter)
    assert (counter.warnings, counter.errors) == (2, 2)
    assert (counter.warnings_expected, counter.warnings_unexpected) == (0, 2)


def test_log_counter_separa_esperadas_de_inesperadas():
    logger = logging.getLogger("test_log_counter_esperadas")
    counter = LogCounter()
    logger.addHandler(counter)
    try:
        logger.warning("sin horarios", extra=run_summary.EXPECTED_WARNING)
        logger.warning("sin horarios", extra=run_summary.EXPECTED_WARNING)
        logger.warning("fecha inválida")
    finally:
        logger.removeHandler(counter)
    assert (counter.warnings_expected, counter.warnings_unexpected, counter.warnings) == (2, 1, 3)
    data = RunSummary().to_dict(0, counter)
    assert (data["warnings"], data["warnings_expected"], data["warnings_unexpected"]) == (3, 2, 1)


def test_sin_horarios_en_banner_es_una_advertencia_esperada():
    counter = LogCounter()
    logging.getLogger().addHandler(counter)
    try:
        # Sin bloques utilizables, _replace_schedule avisa y no toca la BD.
        populate_db._replace_schedule(None, 1, {"crn": "51051", "schedules": []})
    finally:
        logging.getLogger().removeHandler(counter)
    assert (counter.warnings_expected, counter.warnings_unexpected) == (1, 0)


# ──────────────────────────────────────────────────────────────────────────────
# run_etl siempre escribe el resumen
# ──────────────────────────────────────────────────────────────────────────────

class _FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.last = sql

    def fetchall(self):
        if "nombre" in self.last:
            return [(c, n) for c, n in self.conn.names.items()]
        return list(self.conn.active.items())

    def fetchone(self):
        return None


class _FakeConn:
    """Conexión falsa: solo lo que run() usa entre la carga y la regla de activo."""

    def __init__(self):
        self.active = {"202620": True}
        self.names = {"202620": "Ciclo II 2026"}
        self.autocommit = True
        self.commits = 0

    def cursor(self):
        return _FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass

    def close(self):
        pass


@pytest.fixture
def etl(monkeypatch, tmp_path):
    """run_etl con Banner, la BD y la malla mockeados."""
    conn = _FakeConn()
    snapshots = {
        "202620": [{"1": _s(), "2": _s()}, {"1": _s(), "2": _s(estado="agotada")}],
        "202710": [{}, {"9": _s("EIF300", blocks=0)}],
    }
    monkeypatch.setattr(run_etl, "check_db", lambda: [("202620", True)])
    monkeypatch.setattr(run_etl.excel_loader, "run", lambda: True)
    monkeypatch.setattr(populate_db, "_connect", lambda *a, **k: conn)
    monkeypatch.setattr(populate_db, "load_catalog_and_syllabus", lambda c: {})
    monkeypatch.setattr(run_etl, "discover_terms", lambda today, active, override: [
        TermStatus("202620", True, False, 63),
        TermStatus("202710", True, False, 64),
    ])
    monkeypatch.setattr(run_etl.banner_connector, "extract_term", lambda term: {})

    class _Stats:
        total = 1
        dates_blocked = False

    monkeypatch.setattr(populate_db, "load_term", lambda c, term, e, m: _Stats())
    monkeypatch.setattr(run_summary, "snapshot_term_by_code", lambda c, term: snapshots[term].pop(0))
    monkeypatch.setattr(populate_db, "apply_active_rule", lambda c, st, today, u: [])
    monkeypatch.setattr(populate_db, "quality_report", lambda c: None)
    path = tmp_path / "run_summary.json"
    return {"conn": conn, "path": path, "monkeypatch": monkeypatch}


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_corrida_ok_escribe_resumen_con_cambios(etl):
    code = run_etl.run_with_summary(date(2026, 10, 29), etl["path"])
    data = _read(etl["path"])
    assert code == 0 and data["exit_code"] == 0
    assert data["status"] == "ok" and data["has_changes"] is True
    by_code = {t["code"]: t for t in data["terms"]}
    assert [r["nrc"] for r in by_code["202620"]["exhausted"]] == ["2"]
    assert by_code["202710"]["first_load"] is True and data["new_terms"] == ["202710"]


def test_resumen_viejo_se_borra_al_arrancar(etl):
    etl["path"].write_text('{"status": "ok", "viejo": true}', encoding="utf-8")
    run_etl.run_with_summary(date(2026, 10, 29), etl["path"])
    assert "viejo" not in _read(etl["path"])


def test_resumen_se_escribe_si_la_bd_no_responde(etl):
    etl["monkeypatch"].setattr(run_etl, "check_db", lambda: None)
    code = run_etl.run_with_summary(date(2026, 10, 29), etl["path"])
    data = _read(etl["path"])
    assert code == 2 and data["exit_code"] == 2
    assert data["status"] == "failed" and data["fatal_reason"] == "db_unavailable"


def test_resumen_se_escribe_si_falla_la_malla(etl):
    etl["monkeypatch"].setattr(run_etl.excel_loader, "run", lambda: False)
    run_etl.run_with_summary(date(2026, 10, 29), etl["path"])
    data = _read(etl["path"])
    assert data["status"] == "failed" and data["fatal_reason"] == "syllabus"


def test_resumen_se_escribe_si_explota_antes_de_la_carga(etl):
    def boom():
        raise RuntimeError("excel roto")
    etl["monkeypatch"].setattr(run_etl.excel_loader, "run", boom)
    code = run_etl.run_with_summary(date(2026, 10, 29), etl["path"])
    data = _read(etl["path"])
    assert code == 1 and data["status"] == "failed" and data["fatal_reason"] == "unexpected"
    assert data["errors"] >= 1


def test_resumen_con_fallo_parcial(etl):
    def extract(term):
        if term == "202710":
            raise RuntimeError("Banner caído")
        return {}
    etl["monkeypatch"].setattr(run_etl.banner_connector, "extract_term", extract)
    code = run_etl.run_with_summary(date(2026, 10, 29), etl["path"])
    data = _read(etl["path"])
    assert code == 1 and data["status"] == "partial_failure"
    assert data["failed_terms"] == [{"code": "202710", "name": "Ciclo I 2027"}]
    assert [t["code"] for t in data["terms"]] == ["202620"]
    assert data["errors"] >= 1


def test_resumen_con_todos_los_periodos_fallidos(etl):
    def extract(term):
        raise RuntimeError("Banner caído")
    etl["monkeypatch"].setattr(run_etl.banner_connector, "extract_term", extract)
    run_etl.run_with_summary(date(2026, 10, 29), etl["path"])
    data = _read(etl["path"])
    assert data["status"] == "failed" and data["fatal_reason"] is None
    assert len(data["failed_terms"]) == 2


def test_resumen_con_cambio_de_activo(etl):
    conn = etl["conn"]

    def apply(c, st, today, untrusted):
        conn.active = {"202620": True, "202710": True}
        conn.names["202710"] = "Ciclo I 2027"
    etl["monkeypatch"].setattr(populate_db, "apply_active_rule", apply)
    run_etl.run_with_summary(date(2026, 10, 29), etl["path"])
    data = _read(etl["path"])
    assert data["active_changes"] == [{"code": "202710", "name": "Ciclo I 2027", "active": True}]


# ──────────────────────────────────────────────────────────────────────────────
# snapshot_term contra la BD local (transacción revertida)
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


def _section(nrc, course="TST100", title="Curso de prueba", schedules=None):
    return {
        "crn": nrc, "course": course, "title": title, "credits": 3,
        "campus": "SRB: Campus Coto", "type": "Teórico", "section": "01",
        "capacity": 30, "enrolled": 10, "available": 20,
        "instructor": "", "instructor_email": None,
        "schedules": schedules if schedules is not None else [
            {"day": "Lunes", "start": "08:00", "end": "09:40", "classroom": "A1"}
        ],
        "start_date": "07/20/2099", "end_date": "11/14/2099", "is_general": False,
        "metadata": {"banner_program": "isi"},
    }


def _load(conn, term, sections):
    extraction = {"isi": {"sections": sections, "failed_codes": []}}
    period_id = populate_db._insert_term(conn, term)
    populate_db._load_term_sections(conn, period_id, term, extraction)


def test_snapshot_term_contra_la_bd(conn):
    term = "209920"
    assert run_summary.snapshot_term_by_code(conn, term) == {}  # período inexistente

    _load(conn, term, [
        _section("99101", title="Programaci&oacute;n I"),
        _section("99102", schedules=[]),
    ])
    before = run_summary.snapshot_term_by_code(conn, term)
    assert set(before) == {"99101", "99102"}
    assert before["99101"] == SectionState("TST100", "Programaci&oacute;n I", "activa", 1)
    assert before["99102"].blocks == 0

    # Segunda corrida: 99101 desaparece de Banner, 99102 publica horario, 99103 es nueva.
    _load(conn, term, [_section("99102"), _section("99103")])
    after = run_summary.snapshot_term_by_code(conn, term)
    d = diff_term(before, after)
    assert [r["nrc"] for r in d.exhausted] == ["99101"]
    assert [r["nrc"] for r in d.schedule_published] == ["99102"]
    assert [r["nrc"] for r in d.new] == ["99103"]

    # Reaparece 99101.
    _load(conn, term, [_section("99101"), _section("99102"), _section("99103")])
    d2 = diff_term(after, run_summary.snapshot_term_by_code(conn, term))
    assert [r["nrc"] for r in d2.reappeared] == ["99101"] and not d2.new


def test_snapshot_prefiere_el_nombre_de_la_malla(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT codigo, nombre FROM curso WHERE nombre <> '' ORDER BY codigo LIMIT 1")
        code, name = cur.fetchone()
    term = "209920"
    _load(conn, term, [_section("99201", course=code, title="TITULO DE BANNER")])
    with conn.cursor() as cur:
        # El MERGE de populate_db es el que asigna id_curso; acá se simula.
        cur.execute(
            "UPDATE seccion SET id_curso = (SELECT id_curso FROM curso WHERE codigo = %s) "
            "WHERE nrc = '99201' AND id_periodo = (SELECT id_periodo FROM periodo WHERE codigo = %s)",
            (code, term),
        )
    snap = run_summary.snapshot_term_by_code(conn, term)
    assert snap["99201"].course_name == name

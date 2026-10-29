# tests/test_notify_telegram.py
"""
Tests de notify_telegram.py: reglas de envío, formato y truncado, secrets
ausentes y que el token nunca llegue al log.

NINGÚN test manda mensajes reales: un fixture autouse reemplaza urlopen
por uno que falla si se llama. Los tests que necesitan "enviar" instalan
su propio urlopen falso y revisan qué se habría mandado.
"""

import io
import json
import logging
import sys
import urllib.error
import urllib.parse
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import notify_telegram as nt

TOKEN = "123456:SECRETO-de-prueba-no-real"
MONDAY = date(2026, 11, 2)
THURSDAY = date(2026, 10, 29)
# 12:05 UTC del jueves = 06:05 en Costa Rica
THURSDAY_NOW = datetime(2026, 10, 29, 12, 5, tzinfo=timezone.utc)
MONDAY_NOW = datetime(2026, 11, 2, 12, 5, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("un test intentó llamar a la API real de Telegram")
    monkeypatch.setattr(nt.urllib.request, "urlopen", forbidden)
    for var in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "GITHUB_EVENT_NAME", "GITHUB_STEP_SUMMARY"):
        monkeypatch.delenv(var, raising=False)


class _Response:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def telegram(monkeypatch):
    """urlopen falso que registra lo que se habría enviado."""
    sent = []

    def fake(request, timeout=None):
        sent.append(dict(urllib.parse.parse_qsl(request.data.decode())))
        return _Response({"ok": True})
    monkeypatch.setattr(nt.urllib.request, "urlopen", fake)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "-100200300")
    return sent


# ──────────────────────────────────────────────────────────────────────────────
# Resúmenes de ejemplo
# ──────────────────────────────────────────────────────────────────────────────

def _ref(nrc, code, name):
    return {"nrc": nrc, "course_code": code, "course_name": name}


def _term(code, name, first_load=False, total=0, with_schedule=0, **cats):
    t = {"code": code, "name": name, "is_new": first_load, "first_load": first_load,
         "sections_total": total, "sections_with_schedule": with_schedule,
         "new": [], "exhausted": [], "reappeared": [], "schedule_published": []}
    t.update(cats)
    t["has_changes"] = any(t[c] for c in ("new", "exhausted", "reappeared", "schedule_published"))
    return t


def _summary(terms=(), status="ok", has_changes=None, warnings_unexpected=0, errors=0,
             failed_terms=(), fatal_reason=None, active_changes=(), warnings_expected=0):
    terms = list(terms)
    if has_changes is None:
        has_changes = any(t["has_changes"] for t in terms) or bool(active_changes)
    return {
        "version": 1, "started_at": "2026-10-29T12:02:00+00:00",
        "finished_at": "2026-10-29T12:20:00+00:00",
        "exit_code": 0 if status == "ok" else 1, "status": status,
        "fatal_reason": fatal_reason, "has_changes": has_changes,
        "warnings": warnings_expected + warnings_unexpected,
        "warnings_expected": warnings_expected, "warnings_unexpected": warnings_unexpected,
        "errors": errors,
        "new_terms": [t["code"] for t in terms if t["is_new"]],
        "failed_terms": list(failed_terms), "active_changes": list(active_changes),
        "terms": terms,
    }


def _no_changes():
    return _summary([_term("202620", "Ciclo II 2026", total=63)], has_changes=False)


def _with_changes():
    return _summary([_term("202620", "Ciclo II 2026", total=63,
                           new=[_ref("51001", "EIF207", "Estructuras de datos")])])


def _first_run_summary():
    """Primera corrida real: ~48 agotadas en 202620 y tres primeras cargas."""
    exhausted = [_ref(str(52000 + i), f"EIF{100 + i % 40:03d}", f"Curso {i % 40}") for i in range(48)]
    return _summary(
        [
            _term("202620", "Ciclo II 2026", total=111, with_schedule=111, exhausted=exhausted,
                  new=[_ref("51051", "ETA102", "Programaci&oacute;n I")]),
            _term("202695", "Ciclo III (Verano) 2026", first_load=True, total=14, with_schedule=14,
                  new=[_ref(str(60000 + i), "X", "X") for i in range(14)]),
            _term("202710", "Ciclo I 2027", first_load=True, total=64, with_schedule=0,
                  new=[_ref(str(61000 + i), "X", "X") for i in range(64)]),
            _term("202720", "Ciclo II 2027", first_load=True, total=45, with_schedule=0,
                  new=[_ref(str(62000 + i), "X", "X") for i in range(45)]),
        ],
        # 109 "sin horarios en Banner" (202710/202720) + 1 sección sin fechas.
        warnings_expected=109, warnings_unexpected=1,
        active_changes=[{"code": c, "name": n, "active": True}
                        for c, n in [("202695", "Ciclo III (Verano) 2026"),
                                     ("202710", "Ciclo I 2027"), ("202720", "Ciclo II 2027")]],
    )


# ──────────────────────────────────────────────────────────────────────────────
# Reglas de envío
# ──────────────────────────────────────────────────────────────────────────────

def test_decide_cambios():
    assert nt.decide(_with_changes(), THURSDAY, "schedule") == nt.KIND_CHANGES


def test_decide_sin_cambios_fuera_del_lunes_no_manda_nada():
    assert nt.decide(_no_changes(), THURSDAY, "schedule") is None


def test_decide_lunes_sin_cambios_es_latido():
    assert nt.decide(_no_changes(), MONDAY, "schedule") == nt.KIND_HEARTBEAT


def test_decide_lunes_con_cambios_manda_solo_el_resumen():
    assert nt.decide(_with_changes(), MONDAY, "schedule") == nt.KIND_CHANGES


def test_decide_corrida_manual_sin_cambios():
    assert nt.decide(_no_changes(), THURSDAY, "workflow_dispatch") == nt.KIND_NO_CHANGES


@pytest.mark.parametrize("status", ["failed", "partial_failure"])
def test_decide_fallo_y_fallo_parcial(status):
    assert nt.decide(_summary(status=status, has_changes=False), THURSDAY, "schedule") == nt.KIND_FAILURE
    assert nt.decide(_summary(status=status, has_changes=False), MONDAY, "workflow_dispatch") == nt.KIND_FAILURE


def test_decide_resumen_ausente_es_fallo():
    assert nt.decide(None, THURSDAY, "schedule") == nt.KIND_FAILURE


def test_lunes_en_hora_de_costa_rica():
    # Lunes 02:00 UTC todavía es domingo en Costa Rica (UTC-6).
    assert nt.cr_today(datetime(2026, 11, 2, 2, 0, tzinfo=timezone.utc)) == date(2026, 11, 1)
    assert nt.cr_today(MONDAY_NOW).weekday() == 0


# ──────────────────────────────────────────────────────────────────────────────
# Formato
# ──────────────────────────────────────────────────────────────────────────────

def test_formato_de_cambios_agrupa_por_curso_con_nombre():
    summary = _summary([
        _term("202710", "Ciclo I 2027", total=64,
              new=[_ref("1", "EIF206", "Programación II"), _ref("2", "EIF206", "Programación II")],
              schedule_published=[_ref("3", "EIF207", "Estructuras de datos")]),
    ], warnings_unexpected=1)
    msg = nt.format_message(summary, nt.KIND_CHANGES)
    assert msg.splitlines() == [
        "📚 SIHA · ETL 29/oct 06:02",
        "Ciclo I 2027",
        "• Estructuras de datos: horario publicado",
        "• Programación II: 2 secciones nuevas",
        "⚠ 1 advertencia",
    ]
    assert "EIF206" not in msg and "NRC" not in msg and "\n• 1" not in msg


def test_varias_categorias_del_mismo_curso_en_un_renglon():
    summary = _summary([_term("202620", "Ciclo II 2026", total=10,
                              new=[_ref("1", "EIF206", "Programación II")],
                              exhausted=[_ref("2", "EIF206", "Programación II")])])
    assert "• Programación II: 1 sección nueva, 1 sección agotada" in nt.format_message(summary, nt.KIND_CHANGES)


def test_nombre_de_banner_con_entidades_html():
    summary = _summary([_term("202620", "Ciclo II 2026", total=10,
                              new=[_ref("1", "ETA102", "Programaci&oacute;n I &amp; Lab")])])
    msg = nt.format_message(summary, nt.KIND_CHANGES)
    assert "• Programación I & Lab: 1 sección nueva" in msg and "&oacute;" not in msg


def test_curso_fuera_de_malla_usa_el_titulo_de_banner():
    # El resumen ya trae course_name = seccion.titulo cuando no hay curso en la malla.
    summary = _summary([_term("202620", "Ciclo II 2026", total=10,
                              exhausted=[_ref("1", "DEY414", "TALLER DE DEPORTE")])])
    assert "• TALLER DE DEPORTE: 1 sección agotada" in nt.format_message(summary, nt.KIND_CHANGES)


def test_sin_nombre_usa_el_codigo():
    summary = _summary([_term("202620", "Ciclo II 2026", total=10,
                              new=[_ref("1", "XYZ999", "")])])
    assert "• XYZ999: 1 sección nueva" in nt.format_message(summary, nt.KIND_CHANGES)


def test_muchas_agotadas_van_en_un_solo_renglon():
    exhausted = [_ref(str(i), f"C{i % 31:02d}", f"Curso {i % 31}") for i in range(48)]
    summary = _summary([_term("202620", "Ciclo II 2026", total=111, exhausted=exhausted)])
    lines = nt.format_message(summary, nt.KIND_CHANGES).splitlines()
    assert lines[1:] == ["Ciclo II 2026", "• 48 secciones pasaron a agotada (31 cursos)"]


def test_tope_de_15_renglones_de_curso():
    new = [_ref(str(i), f"C{i:02d}", f"Curso {i:02d}") for i in range(5)]
    terms = [_term(f"2027{i:02d}", f"Período {i}", total=5, new=new) for i in (10, 20, 95, 30)]
    msg = nt.format_message(_summary(terms), nt.KIND_CHANGES)
    bullets = [l for l in msg.splitlines() if l.startswith("• ")]
    assert len(bullets) == 15
    assert msg.splitlines()[-1] == "… y 5 más"
    # Sin truncar (resumen de GitHub): los 20.
    full = nt.format_message(_summary(terms), nt.KIND_CHANGES, max_lines=None)
    assert len([l for l in full.splitlines() if l.startswith("• ")]) == 20


def test_primera_carga_de_tres_periodos():
    msg = nt.format_message(_first_run_summary(), nt.KIND_CHANGES)
    lines = msg.splitlines()
    assert "• primera carga: 14 secciones (14 con horario)" in lines
    assert "• primera carga: 64 secciones (0 con horario)" in lines
    assert "• primera carga: 45 secciones (0 con horario)" in lines
    assert "• 48 secciones pasaron a agotada (40 cursos)" in lines
    assert "• Programación I: 1 sección nueva" in lines
    assert len([l for l in lines if l.startswith("• ")]) <= nt.MAX_LINES
    assert len(msg) < 4096  # límite de Telegram
    assert "52000" not in msg and "51051" not in msg  # sin NRC


def test_cambio_de_activo():
    summary = _summary([], active_changes=[{"code": "202620", "name": "Ciclo II 2026", "active": False}])
    assert "Ciclo II 2026\n• ya no seleccionable (inactivo)" in nt.format_message(summary, nt.KIND_CHANGES)


def test_mensaje_de_fallo_parcial_con_link():
    summary = _summary([_term("202620", "Ciclo II 2026", total=63,
                              new=[_ref("1", "EIF206", "Programación II")])],
                       status="partial_failure", errors=2,
                       failed_terms=[{"code": "202710", "name": "Ciclo I 2027"}])
    msg = nt.format_message(summary, nt.KIND_FAILURE, "https://github.com/x/y/actions/runs/1")
    lines = msg.splitlines()
    assert lines[0] == "⚠️ SIHA · ETL 29/oct 06:02: fallo parcial. Falló Ciclo I 2027 (202710); el resto se cargó"
    assert "• Programación II: 1 sección nueva" in lines
    assert "⚠ 2 errores" in lines
    assert lines[-1] == "Ver corrida: https://github.com/x/y/actions/runs/1"


def test_mensaje_de_fallo_por_bd():
    summary = _summary(status="failed", fatal_reason="db_unavailable", errors=2, has_changes=False)
    msg = nt.format_message(summary, nt.KIND_FAILURE, "URL")
    assert msg.splitlines()[0] == "❌ SIHA · ETL 29/oct 06:02: falló (no se pudo conectar a la BD)"
    assert msg.endswith("Ver corrida: URL")


def test_mensaje_sin_resumen():
    msg = nt.format_message(None, nt.KIND_FAILURE, "URL")
    assert "murió antes de generar el resumen" in msg and msg.endswith("Ver corrida: URL")


def test_latido_y_corrida_manual():
    assert nt.format_message(_no_changes(), nt.KIND_HEARTBEAT) == nt.HEARTBEAT_MESSAGE
    assert nt.format_message(_no_changes(), nt.KIND_NO_CHANGES) == nt.MANUAL_NO_CHANGES_MESSAGE


# ──────────────────────────────────────────────────────────────────────────────
# main: envío, secrets y token
# ──────────────────────────────────────────────────────────────────────────────

def _write(tmp_path, summary):
    path = tmp_path / "run_summary.json"
    path.write_text(json.dumps(summary), encoding="utf-8")
    return path


def test_main_envia_resumen_de_cambios(tmp_path, telegram, monkeypatch):
    step = tmp_path / "step.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(step))
    code = nt.main(["--summary", str(_write(tmp_path, _with_changes()))], now=THURSDAY_NOW)
    assert code == 0 and len(telegram) == 1
    assert telegram[0]["chat_id"] == "-100200300"
    assert "Estructuras de datos: 1 sección nueva" in telegram[0]["text"]
    assert "Estructuras de datos" in step.read_text(encoding="utf-8")


def test_main_sin_cambios_no_envia_pero_escribe_el_step_summary(tmp_path, telegram, monkeypatch):
    step = tmp_path / "step.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(step))
    assert nt.main(["--summary", str(_write(tmp_path, _no_changes()))], now=THURSDAY_NOW) == 0
    assert telegram == []
    assert "no se envía" in step.read_text(encoding="utf-8")


def test_main_lunes_manda_latido(tmp_path, telegram):
    assert nt.main(["--summary", str(_write(tmp_path, _no_changes()))], now=MONDAY_NOW) == 0
    assert [m["text"] for m in telegram] == [nt.HEARTBEAT_MESSAGE]


def test_main_corrida_manual_sin_cambios(tmp_path, telegram, monkeypatch):
    monkeypatch.setenv("GITHUB_EVENT_NAME", "workflow_dispatch")
    assert nt.main(["--summary", str(_write(tmp_path, _no_changes()))], now=THURSDAY_NOW) == 0
    assert [m["text"] for m in telegram] == [nt.MANUAL_NO_CHANGES_MESSAGE]


def test_main_resumen_ausente_avisa_fallo(tmp_path, telegram):
    code = nt.main(["--summary", str(tmp_path / "no-existe.json"), "--run-url", "URL"], now=THURSDAY_NOW)
    assert code == 0 and "murió antes de generar el resumen" in telegram[0]["text"]


def test_main_sin_secrets_avisa_y_no_falla(tmp_path, caplog):
    with caplog.at_level(logging.WARNING, logger="notify_telegram"):
        code = nt.main(["--summary", str(_write(tmp_path, _with_changes()))], now=THURSDAY_NOW)
    assert code == 0
    assert "Faltan TELEGRAM_BOT_TOKEN" in caplog.text


def test_main_test_envia_mensaje_de_prueba_sin_leer_resumen(tmp_path, telegram):
    assert nt.main(["--test", "--summary", str(tmp_path / "no-existe.json")]) == 0
    assert [m["text"] for m in telegram] == ["SIHA ETL: notificaciones OK"]


def test_main_test_sin_secrets_falla(caplog):
    assert nt.main(["--test"]) == 1


def _failing_urlopen(exc):
    def fake(request, timeout=None):
        raise exc(request)
    return fake


@pytest.mark.parametrize("make_error", [
    lambda req: urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {},
                                       io.BytesIO(b'{"ok":false,"description":"Unauthorized"}')),
    lambda req: urllib.error.URLError(f"no se pudo abrir {req.full_url}"),
    lambda req: TimeoutError(f"timeout en {req.full_url}"),
])
def test_si_falla_el_envio_el_token_no_aparece_en_el_log(tmp_path, monkeypatch, caplog, capsys, make_error):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "1")
    monkeypatch.setattr(nt.urllib.request, "urlopen", _failing_urlopen(make_error))
    with caplog.at_level(logging.DEBUG):
        code = nt.main(["--summary", str(_write(tmp_path, _with_changes()))], now=THURSDAY_NOW)
    out = capsys.readouterr()
    assert code == 1
    assert "El ETL terminó bien; solo falló el aviso a Telegram" in caplog.text
    for text in (caplog.text, out.out, out.err):
        assert TOKEN not in text and "SECRETO" not in text


def test_si_falla_el_envio_tras_un_etl_fallido_lo_dice(tmp_path, monkeypatch, caplog):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "1")
    monkeypatch.setattr(nt.urllib.request, "urlopen",
                        _failing_urlopen(lambda req: urllib.error.URLError("x")))
    summary = _summary(status="failed", fatal_reason="unexpected", has_changes=False)
    assert nt.main(["--summary", str(_write(tmp_path, summary))], now=THURSDAY_NOW) == 1
    assert "además el ETL falló" in caplog.text


def test_respuesta_ok_false_de_telegram_es_error(monkeypatch):
    monkeypatch.setattr(nt.urllib.request, "urlopen",
                        lambda req, timeout=None: _Response({"ok": False, "description": f"bad {TOKEN}"}))
    with pytest.raises(nt.TelegramSendError) as err:
        nt.send(TOKEN, "1", "hola")
    assert TOKEN not in str(err.value)


def test_filtro_redacta_el_token_en_cualquier_log(caplog):
    nt.log.addFilter(f := nt.RedactTokenFilter(TOKEN))
    try:
        with caplog.at_level(logging.INFO, logger="notify_telegram"):
            nt.log.info("url https://api.telegram.org/bot%s/sendMessage", TOKEN)
    finally:
        nt.log.removeFilter(f)
    assert TOKEN not in caplog.text and "bot***/sendMessage" in caplog.text


# ──────────────────────────────────────────────────────────────────────────────
# Advertencias esperadas / inesperadas
# ──────────────────────────────────────────────────────────────────────────────

def test_solo_advertencias_esperadas_no_llevan_linea_de_aviso():
    summary = _summary([_term("202620", "Ciclo II 2026", total=10,
                              new=[_ref("1", "EIF206", "Programación II")])],
                       warnings_expected=109)
    msg = nt.format_message(summary, nt.KIND_CHANGES)
    assert "⚠" not in msg
    assert "⚠" not in nt.format_message(summary, nt.KIND_HEARTBEAT)


def test_mezcla_cuenta_solo_las_inesperadas():
    summary = _summary([_term("202620", "Ciclo II 2026", total=10,
                              new=[_ref("1", "EIF206", "Programación II")])],
                       warnings_expected=109, warnings_unexpected=3)
    assert nt.format_message(summary, nt.KIND_CHANGES).splitlines()[-1] == "⚠ 3 advertencias"


def test_solo_inesperadas_llevan_su_numero():
    summary = _summary([_term("202620", "Ciclo II 2026", total=10,
                              new=[_ref("1", "EIF206", "Programación II")])],
                       warnings_unexpected=2, errors=1)
    assert nt.format_message(summary, nt.KIND_CHANGES).splitlines()[-1] == "⚠ 2 advertencias · 1 error"


def test_resumen_viejo_sin_separacion_cuenta_todas():
    summary = _summary([], has_changes=False)
    del summary["warnings_expected"], summary["warnings_unexpected"]
    summary["warnings"] = 4
    assert nt.format_message(summary, nt.KIND_HEARTBEAT).endswith("⚠ 4 advertencias")


def test_step_summary_muestra_esperadas_e_inesperadas(tmp_path, telegram, monkeypatch):
    step = tmp_path / "step.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(step))
    summary = _summary([_term("202620", "Ciclo II 2026", total=10,
                              new=[_ref("1", "EIF206", "Programación II")])],
                       warnings_expected=109, warnings_unexpected=1)
    nt.main(["--summary", str(_write(tmp_path, summary))], now=THURSDAY_NOW)
    text = step.read_text(encoding="utf-8")
    assert "Advertencias: 1 inesperadas, 109 esperadas (sin horarios en Banner)" in text
    assert "⚠ 109" not in telegram[0]["text"] and telegram[0]["text"].endswith("⚠ 1 advertencia")

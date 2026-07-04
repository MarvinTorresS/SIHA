# tests/test_banner.py
"""Tests unitarios para banner_connector.py"""

import pytest
from extractors.banner_connector import (
    _parse_horarios,
    _parse_profesor,
    _parse_creditos,
    _parse_fechas,
    _es_subject_general,
    _ensamblar_seccion,
    _extraer_token,
    _DIAS_BOOL,
    _fmt_hora,
)

# ── _fmt_hora ────────────────────────────────────────────────────────────

def test_fmt_hora_normal():
    assert _fmt_hora("0800") == "08:00"
    assert _fmt_hora("1430") == "14:30"

def test_fmt_hora_corta():
    assert _fmt_hora("800") == "800"  # no tiene 4 dígitos
    assert _fmt_hora("") == ""

def test_fmt_hora_none():
    assert _fmt_hora(None) == ""

def test_fmt_hora_larga():
    """Longitud != 4 ahora se descarta, incluyendo strings más largos."""
    assert _fmt_hora("080000") == "080000"

def test_fmt_hora_no_numerica():
    """Basura no numérica de 4 caracteres se descarta."""
    assert _fmt_hora("08a0") == "08a0"


# ── _parse_horarios ──────────────────────────────────────────────────────

def test_parse_horarios_un_bloque():
    meetings = [{
        "meetingTime": {
            "beginTime": "0800",
            "endTime": "0950",
            "monday": True,
            "tuesday": False,
        }
    }]
    result = _parse_horarios(meetings)
    assert len(result) == 1
    assert result[0]["dia"] == "Lunes"
    assert result[0]["inicio"] == "08:00"
    assert result[0]["fin"] == "09:50"

def test_parse_horarios_dos_dias():
    meetings = [{
        "meetingTime": {
            "beginTime": "1300",
            "endTime": "1450",
            "monday": True,
            "wednesday": True,
        }
    }]
    result = _parse_horarios(meetings)
    assert len(result) == 2
    dias = {r["dia"] for r in result}
    assert dias == {"Lunes", "Miércoles"}

def test_parse_horarios_teoria_y_lab():
    """Dos bloques: teoría un día/aula, lab otro día/aula."""
    meetings = [
        {
            "meetingTime": {
                "beginTime": "0800", "endTime": "0950",
                "monday": True,
                "building": "IC", "room": "301",
            }
        },
        {
            "meetingTime": {
                "beginTime": "1000", "endTime": "1150",
                "thursday": True,
                "building": "LAB", "room": "5",
            }
        }
    ]
    result = _parse_horarios(meetings)
    assert len(result) == 2

def test_parse_horarios_aula_por_bloque():
    """Cada bloque debe reportar SU PROPIA aula, no la del primero."""
    meetings = [
        {
            "meetingTime": {
                "beginTime": "0800", "endTime": "0950",
                "monday": True,
                "building": "IC", "room": "301",
            }
        },
        {
            "meetingTime": {
                "beginTime": "1300", "endTime": "1450",
                "friday": True,
                "building": "LAB", "room": "5",
            }
        }
    ]
    result = _parse_horarios(meetings)
    aulas_por_dia = {r["dia"]: r["aula"] for r in result}
    assert aulas_por_dia["Lunes"] == "IC-301"
    assert aulas_por_dia["Viernes"] == "LAB-5"

def test_parse_horarios_sin_hora():
    meetings = [{"meetingTime": {"beginTime": "", "endTime": ""}}]
    assert _parse_horarios(meetings) == []

def test_parse_horarios_vacio():
    assert _parse_horarios([]) == []

def test_parse_horarios_sin_meetingTime_key():
    """Bloque sin la llave 'meetingTime' en absoluto (no None, ausente)."""
    meetings = [{}]
    assert _parse_horarios(meetings) == []

def test_parse_horarios_aula_vacia_sin_edificio_ni_room():
    meetings = [{
        "meetingTime": {
            "beginTime": "0800", "endTime": "0950",
            "monday": True,
            "building": "", "room": "",
        }
    }]
    result = _parse_horarios(meetings)
    assert result[0]["aula"] == ""


# ── _parse_profesor ──────────────────────────────────────────────────────

def test_parse_profesor_primario():
    faculty = [
        {"displayName": "Juan P&eacute;rez", "primaryIndicator": True},
        {"displayName": "Mar&iacute;a L&oacute;pez", "primaryIndicator": False},
    ]
    assert _parse_profesor(faculty) == "Juan Pérez"

def test_parse_profesor_sin_primario():
    faculty = [
        {"displayName": "Ana Rojas"},
    ]
    assert _parse_profesor(faculty) == "Ana Rojas"

def test_parse_profesor_vacio():
    assert _parse_profesor([]) == ""

def test_parse_profesor_displayName_none():
    """displayName=None no debe reventar unescape()."""
    faculty = [{"displayName": None, "primaryIndicator": True}]
    assert _parse_profesor(faculty) == ""

def test_parse_profesor_displayName_ausente():
    faculty = [{"primaryIndicator": True}]
    assert _parse_profesor(faculty) == ""


# ── _parse_creditos ──────────────────────────────────────────────────────

def test_parse_creditos_creditHourLow():
    sec = {"creditHourLow": 4, "creditHourHigh": 4}
    assert _parse_creditos(sec) == 4

def test_parse_creditos_fallback():
    sec = {"numberOfUnits": 3}
    assert _parse_creditos(sec) == 3

def test_parse_creditos_cero():
    assert _parse_creditos({}) == 0

def test_parse_creditos_rango_variable():
    """low != high → string 'low-high', no se pierde el rango."""
    sec = {"creditHourLow": 1, "creditHourHigh": 3}
    assert _parse_creditos(sec) == "1-3"

def test_parse_creditos_solo_low_high_none():
    sec = {"creditHourLow": 4, "creditHourHigh": None}
    assert _parse_creditos(sec) == 4

def test_parse_creditos_low_cero_high_presente():
    """low=0 (falsy pero no None) y high=3 distintos → debe ser '0-3', no solo 3."""
    sec = {"creditHourLow": 0, "creditHourHigh": 3}
    assert _parse_creditos(sec) == "0-3"


# ── _parse_fechas ─────────────────────────────────────────────────────────

def test_parse_fechas_normal():
    meetings = [{"meetingTime": {"startDate": "2026-08-03", "endDate": "2026-12-04"}}]
    assert _parse_fechas(meetings) == ("2026-08-03", "2026-12-04")

def test_parse_fechas_vacio():
    assert _parse_fechas([]) == ("", "")

def test_parse_fechas_sin_meetingTime():
    assert _parse_fechas([{}]) == ("", "")

def test_parse_fechas_solo_usa_primer_bloque():
    meetings = [
        {"meetingTime": {"startDate": "2026-08-03", "endDate": "2026-12-04"}},
        {"meetingTime": {"startDate": "2026-09-01", "endDate": "2026-11-01"}},
    ]
    assert _parse_fechas(meetings) == ("2026-08-03", "2026-12-04")


# ── _es_subject_general ──────────────────────────────────────────────────

def test_es_subject_general_prefijo():
    assert _es_subject_general("EGF") is True
    assert _es_subject_general("EIF") is False

def test_es_subject_general_codigo_completo():
    assert _es_subject_general("EGF128") is True
    assert _es_subject_general("EIF207") is False

def test_es_subject_general_codigo_corto():
    assert _es_subject_general("EG") is False  # menos de 3 caracteres


# ── _extraer_token ───────────────────────────────────────────────────────

def test_extraer_token_meta_tag():
    html = '<meta name="synchronizerToken" content="abc-123-xyz"/>'
    assert _extraer_token(html) == "abc-123-xyz"

def test_extraer_token_otro_formato():
    html = '<input type="hidden" name="synchronizerToken" value="token456"/>'
    assert _extraer_token(html) == "token456"

def test_extraer_token_json():
    html = 'var config = {"synchronizerToken": "json-token-789"};'
    assert _extraer_token(html) == "json-token-789"

def test_extraer_token_no_encontrado():
    with pytest.raises(ValueError, match="synchronizerToken no encontrado"):
        _extraer_token("<html><body>Sin token</body></html>")


# ── _DIAS_BOOL ───────────────────────────────────────────────────────────

def test_dias_bool_completo():
    assert _DIAS_BOOL["monday"] == "Lunes"
    assert _DIAS_BOOL["friday"] == "Viernes"
    assert len(_DIAS_BOOL) == 7


# ── _ensamblar_seccion (test de integración del parsing completo) ───────

SECCION_EJEMPLO = {
    "courseReferenceNumber": "12345",
    "subject": "EIF",
    "courseNumber": "207",
    "courseTitle": "Programaci&oacute;n II",
    "creditHourLow": 4,
    "creditHourHigh": 4,
    "campusDescription": "Campus Coto",
    "scheduleTypeDescription": "Teor&iacute;a",
    "sequenceNumber": "01",
    "maximumEnrollment": 30,
    "enrollment": 28,
    "seatsAvailable": 2,
    "faculty": [
        {"displayName": "Juan P&eacute;rez", "primaryIndicator": True}
    ],
    "meetingsFaculty": [
        {
            "meetingTime": {
                "beginTime": "0800", "endTime": "0950",
                "monday": True, "wednesday": True,
                "building": "IC", "room": "301",
                "startDate": "2026-08-03", "endDate": "2026-12-04",
            }
        },
        {
            "meetingTime": {
                "beginTime": "1300", "endTime": "1450",
                "friday": True,
                "building": "LAB", "room": "5",
                "startDate": "2026-08-03", "endDate": "2026-12-04",
            }
        },
    ],
}

def test_ensamblar_seccion_campos_basicos():
    resultado = _ensamblar_seccion(SECCION_EJEMPLO, "EIF207")
    assert resultado["nrc"] == "12345"
    assert resultado["curso"] == "EIF207"
    assert resultado["titulo"] == "Programación II"
    assert resultado["creditos"] == 4
    assert resultado["campus"] == "Campus Coto"
    assert resultado["tipo"] == "Teoría"
    assert resultado["seccion"] == "01"
    assert resultado["capacidad"] == 30
    assert resultado["inscritos"] == 28
    assert resultado["disponibles"] == 2
    assert resultado["profesor"] == "Juan Pérez"
    assert resultado["es_general"] is False

def test_ensamblar_seccion_horarios_y_aulas_por_bloque():
    resultado = _ensamblar_seccion(SECCION_EJEMPLO, "EIF207")
    assert len(resultado["horarios"]) == 3  # lunes, miércoles, viernes
    aulas_por_dia = {h["dia"]: h["aula"] for h in resultado["horarios"]}
    assert aulas_por_dia["Lunes"] == "IC-301"
    assert aulas_por_dia["Miércoles"] == "IC-301"
    assert aulas_por_dia["Viernes"] == "LAB-5"

def test_ensamblar_seccion_fechas():
    resultado = _ensamblar_seccion(SECCION_EJEMPLO, "EIF207")
    assert resultado["fecha_inicio"] == "2026-08-03"
    assert resultado["fecha_fin"] == "2026-12-04"

def test_ensamblar_seccion_es_general_true():
    sec = dict(SECCION_EJEMPLO)
    resultado = _ensamblar_seccion(sec, "EGF128")
    assert resultado["es_general"] is True

def test_ensamblar_seccion_sin_meetings():
    sec = dict(SECCION_EJEMPLO)
    sec["meetingsFaculty"] = []
    resultado = _ensamblar_seccion(sec, "EIF207")
    assert resultado["horarios"] == []
    assert resultado["fecha_inicio"] == ""
    assert resultado["fecha_fin"] == ""

def test_ensamblar_seccion_sin_faculty():
    sec = dict(SECCION_EJEMPLO)
    sec["faculty"] = []
    resultado = _ensamblar_seccion(sec, "EIF207")
    assert resultado["profesor"] == ""

def test_ensamblar_seccion_creditos_variables():
    sec = dict(SECCION_EJEMPLO)
    sec["creditHourLow"] = 1
    sec["creditHourHigh"] = 3
    resultado = _ensamblar_seccion(sec, "EIF207")
    assert resultado["creditos"] == "1-3"

def test_ensamblar_seccion_campos_faltantes_no_revienta():
    """Sección mínima sin casi nada — no debe lanzar excepción."""
    sec = {}
    resultado = _ensamblar_seccion(sec, "EIF207")
    assert resultado["nrc"] == ""
    assert resultado["titulo"] == ""
    assert resultado["creditos"] == 0
    assert resultado["horarios"] == []
    assert resultado["profesor"] == ""
    assert resultado["es_general"] is False
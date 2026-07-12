# tests/test_banner_instructor_email.py
# Cobertura de _parse_instructor y _build_section (banner_connector.py)
# para el campo de email del profesor.
#
# No toca tests/test_banner.py a propósito: ese archivo ya está roto de
# antes (prueba una API vieja en español que no coincide con el
# banner_connector.py actual) y arreglarlo es una reescritura completa
# aparte, no parte de este cambio puntual de email.
#
# Ejecutar: pytest tests/test_banner_instructor_email.py -v

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extractors.banner_connector import _parse_instructor, _build_section


# ══════════════════════════════════════════════════════════════════════════════
# _parse_instructor
# ══════════════════════════════════════════════════════════════════════════════

class TestParseInstructor:

    def test_extrae_nombre_y_email_del_primario(self):
        # Caso real: EIF200/CRN 50239, confirmado con llamada real a Banner.
        faculty = [
            {
                "displayName": "SCHMIDT FONSECA, ILEANA",
                "emailAddress": "ileana.schmidt.fonseca@una.cr",
                "primaryIndicator": True,
            },
        ]
        name, email = _parse_instructor(faculty)
        assert name == "SCHMIDT FONSECA, ILEANA"
        assert email == "ileana.schmidt.fonseca@una.cr"

    def test_usa_el_primario_no_el_primero(self):
        faculty = [
            {"displayName": "Juan Pérez", "emailAddress": "juan@una.cr", "primaryIndicator": False},
            {"displayName": "María López", "emailAddress": "maria@una.cr", "primaryIndicator": True},
        ]
        name, email = _parse_instructor(faculty)
        assert name == "María López"
        assert email == "maria@una.cr"

    def test_sin_primario_usa_el_primero(self):
        faculty = [{"displayName": "Ana Rojas", "emailAddress": "ana@una.cr"}]
        name, email = _parse_instructor(faculty)
        assert name == "Ana Rojas"
        assert email == "ana@una.cr"

    def test_faculty_vacio_retorna_nombre_vacio_y_email_none(self):
        name, email = _parse_instructor([])
        assert name == ""
        assert email is None

    def test_sin_emailaddress_en_el_payload(self):
        """Banner a veces no trae 'emailAddress' en absoluto (campo ausente)."""
        faculty = [{"displayName": "Juan Pérez", "primaryIndicator": True}]
        name, email = _parse_instructor(faculty)
        assert name == "Juan Pérez"
        assert email is None

    def test_emailaddress_none_no_se_confunde_con_string_none(self):
        faculty = [{"displayName": "Juan Pérez", "emailAddress": None, "primaryIndicator": True}]
        name, email = _parse_instructor(faculty)
        assert email is None

    def test_emailaddress_vacio_se_normaliza_a_none(self):
        faculty = [{"displayName": "Juan Pérez", "emailAddress": "  ", "primaryIndicator": True}]
        _, email = _parse_instructor(faculty)
        assert email is None

    def test_displayname_ausente_no_revienta(self):
        """No debe fallar aunque falte displayName; debe seguir leyendo el email."""
        faculty = [{"emailAddress": "sin.nombre@una.cr", "primaryIndicator": True}]
        name, email = _parse_instructor(faculty)
        assert name == ""
        assert email == "sin.nombre@una.cr"


# ══════════════════════════════════════════════════════════════════════════════
# _build_section — clave "instructor_email"
# ══════════════════════════════════════════════════════════════════════════════

SECCION_BASE = {
    "courseReferenceNumber": "50239",
    "courseTitle": "Fundamentos de inform&aacute;tica",
    "creditHourLow": 3,
    "creditHourHigh": 3,
    "campusDescription": "Campus Coto",
    "scheduleTypeDescription": "Teoría - práctica",
    "sequenceNumber": "01",
    "maximumEnrollment": 30,
    "enrollment": 26,
    "seatsAvailable": 4,
    "meetingsFaculty": [],
}


class TestBuildSectionInstructorEmail:

    def test_incluye_instructor_email_cuando_banner_lo_trae(self):
        sec = dict(SECCION_BASE, faculty=[
            {
                "displayName": "SCHMIDT FONSECA, ILEANA",
                "emailAddress": "ileana.schmidt.fonseca@una.cr",
                "primaryIndicator": True,
            },
        ])
        resultado = _build_section(sec, "EIF200")
        assert resultado["instructor"] == "SCHMIDT FONSECA, ILEANA"
        assert resultado["instructor_email"] == "ileana.schmidt.fonseca@una.cr"

    def test_instructor_email_none_si_banner_no_lo_trae(self):
        sec = dict(SECCION_BASE, faculty=[
            {"displayName": "Juan Pérez", "primaryIndicator": True},
        ])
        resultado = _build_section(sec, "EIF200")
        assert resultado["instructor"] == "Juan Pérez"
        assert resultado["instructor_email"] is None

    def test_instructor_email_none_sin_faculty(self):
        sec = dict(SECCION_BASE, faculty=[])
        resultado = _build_section(sec, "EIF200")
        assert resultado["instructor"] == ""
        assert resultado["instructor_email"] is None

    def test_clave_instructor_email_siempre_presente(self):
        """La clave debe existir siempre (None, no ausente) para que
        populate_db.py pueda hacer sec.get('instructor_email') de forma
        uniforme sin distinguir 'ausente' de 'None'."""
        sec = dict(SECCION_BASE, faculty=[])
        resultado = _build_section(sec, "EIF200")
        assert "instructor_email" in resultado

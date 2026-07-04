# tests/test_malla_scraper.py
# Suite de pruebas para la arquitectura real del malla_scraper.
# Prueba: decodificador unicode, parser JS→JSON, identificador de bloques,
# extracción de cursos y serialización.
#
# Ejecutar: pytest tests/ -v

import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from extractors.malla_scraper import (
    _decodificar_unicode,
    _js_a_json,
    _parsear_bloque,
    _extraer_bloques_mesh,
    _identificar_bloque,
    extraer_malla_carrera,
    CursoMalla,
)


# ══════════════════════════════════════════════════════════════════════════════
# Tests de _decodificar_unicode
# ══════════════════════════════════════════════════════════════════════════════

class TestDecodificarUnicode:

    def test_decodifica_vocal_con_acento(self):
        assert _decodificar_unicode(r"inform\xe1tica") == "informática"

    def test_decodifica_multiple_escapes(self):
        resultado = _decodificar_unicode(r"Matem\xe1tica para inform\xe1tica")
        assert resultado == "Matemática para informática"

    def test_string_sin_escapes_no_cambia(self):
        assert _decodificar_unicode("Programacion I") == "Programacion I"

    def test_decodifica_enye(self):
        assert _decodificar_unicode(r"Primer A\xf1o") == "Primer Año"

    def test_string_vacio(self):
        assert _decodificar_unicode("") == ""


# ══════════════════════════════════════════════════════════════════════════════
# Tests de _js_a_json
# ══════════════════════════════════════════════════════════════════════════════

class TestJsAJson:

    def test_agrega_comillas_a_claves_simples(self):
        resultado = _js_a_json('{EIF200:["Programacion",[],4]}')
        datos = json.loads(resultado)
        assert "EIF200" in datos

    def test_no_duplica_comillas_en_claves_ya_entrecomilladas(self):
        resultado = _js_a_json('{"EIF200":["Programacion",[],4]}')
        datos = json.loads(resultado)
        assert "EIF200" in datos

    def test_decodifica_unicode_en_valores(self):
        resultado = _js_a_json(r'{EIF200:["Programaci\xf3n I",[],4]}')
        datos = json.loads(resultado)
        assert datos["EIF200"][0] == "Programación I"

    def test_multiples_claves_sin_comillas(self):
        js = '{EIF200:["Prog I",[],4],MAT001:["Calculo",[],3]}'
        datos = json.loads(_js_a_json(js))
        assert "EIF200" in datos
        assert "MAT001" in datos

    def test_claves_con_numeros(self):
        js = '{"1 1":{EIF200:["Prog",[],4]}}'
        datos = json.loads(_js_a_json(js))
        assert "1 1" in datos
        assert "EIF200" in datos["1 1"]


# ══════════════════════════════════════════════════════════════════════════════
# Tests de _parsear_bloque
# ══════════════════════════════════════════════════════════════════════════════

class TestParsearBloque:

    def test_parsea_bloque_simple(self):
        bloque = '{"1 1":{EIF200:["Fundamentos",[],0]}}'
        resultado = _parsear_bloque(bloque)
        assert "1 1" in resultado
        assert "EIF200" in resultado["1 1"]

    def test_parsea_prerequisitos_como_lista(self):
        bloque = '{"1 2":{EIF201:["Programacion I",["EIF200","MAT030"],0]}}'
        resultado = _parsear_bloque(bloque)
        prereqs = resultado["1 2"]["EIF201"][1]
        assert "EIF200" in prereqs
        assert "MAT030" in prereqs

    def test_parsea_creditos(self):
        bloque = '{"1 1":{MAT030:["Matematica",[],3]}}'
        resultado = _parsear_bloque(bloque)
        assert resultado["1 1"]["MAT030"][2] == 3

    def test_bloque_invalido_retorna_dict_vacio(self):
        resultado = _parsear_bloque("esto no es json ni js valido {{{{")
        assert resultado == {}

    def test_bloque_vacio_retorna_dict_vacio(self):
        resultado = _parsear_bloque("{}")
        assert resultado == {}


# ══════════════════════════════════════════════════════════════════════════════
# Tests de _extraer_bloques_mesh
# ══════════════════════════════════════════════════════════════════════════════

class TestExtraerBloquesMesh:

    def test_extrae_un_bloque(self):
        js = 'var x = {mesh:{EIF200:["Prog",[],4]}}'
        bloques = _extraer_bloques_mesh(js)
        assert len(bloques) == 1

    def test_extrae_multiples_bloques(self):
        js = 'mesh:{EIF200:["a",[],1]}, mesh:{TGF400:["b",[],2]}'
        bloques = _extraer_bloques_mesh(js)
        assert len(bloques) == 2

    def test_sin_bloques_retorna_lista_vacia(self):
        js = 'var x = {datos: {EIF200: "algo"}}'
        bloques = _extraer_bloques_mesh(js)
        assert bloques == []

    def test_bloques_anidados_correctamente_balanceados(self):
        js = 'mesh:{"1 1":{EIF200:["Prog",[],0],"MAT030":["Mat",[],3]}}'
        bloques = _extraer_bloques_mesh(js)
        assert len(bloques) == 1
        assert "EIF200" in bloques[0]
        assert "MAT030" in bloques[0]


# ══════════════════════════════════════════════════════════════════════════════
# Tests de _identificar_bloque
# ══════════════════════════════════════════════════════════════════════════════

class TestIdentificarBloque:

    def test_identifica_bloque_isi_por_eif200(self):
        bloques = [
            '{"1 1":{TDC400:["Datos",[],3]}}',
            '{"1 1":{EIF200:["Fundamentos",[],0]}}',
        ]
        resultado = _identificar_bloque(bloques, "isi")
        assert resultado is not None
        assert "EIF200" in resultado

    def test_retorna_none_si_no_encuentra(self):
        bloques = ['{"1 1":{TDC400:["Datos",[],3]}}']
        resultado = _identificar_bloque(bloques, "isi")
        assert resultado is None

    def test_lista_vacia_retorna_none(self):
        assert _identificar_bloque([], "isi") is None


# ══════════════════════════════════════════════════════════════════════════════
# Tests de extracción completa con bundle mockeado
# ══════════════════════════════════════════════════════════════════════════════

BUNDLE_MOCK_ISI = """
var app = {
    mesh:{"0 0":{"#Ingenieria":["Ingenieria de Software",[],0]},
    "1 1":{EIF200:["Fundamentos de inform\\xe1tica",[],0],MAT030:["Matem\\xe1tica para inform\\xe1tica",[],3]},
    "1 2":{EIF201:["Programaci\\xf3n I",["EIF200","MAT030"],0],MAT002:["C\\xe1lculo I",["MAT030"],3]},
    "2 1":{EIF204:["Programaci\\xf3n II",["EIF201"],0]},
    "Opt":{EIF420O:["Inteligencia artificial",["EIF207"],0]}}
};
"""


class TestExtraerMallaCarrera:

    def test_extrae_cursos_correctamente(self):
        cursos = extraer_malla_carrera("isi", "Ingeniería en Sistemas", BUNDLE_MOCK_ISI)
        codigos = [c.codigo for c in cursos]
        assert "EIF200" in codigos
        assert "EIF201" in codigos
        assert "MAT030" in codigos

    def test_ignora_ciclo_0_0(self):
        cursos = extraer_malla_carrera("isi", "ISI", BUNDLE_MOCK_ISI)
        codigos = [c.codigo for c in cursos]
        assert "#Ingenieria" not in codigos

    def test_prerequisitos_correctos(self):
        cursos = extraer_malla_carrera("isi", "ISI", BUNDLE_MOCK_ISI)
        eif201 = next(c for c in cursos if c.codigo == "EIF201")
        assert "EIF200" in eif201.prerequisitos
        assert "MAT030" in eif201.prerequisitos

    def test_creditos_correctos(self):
        cursos = extraer_malla_carrera("isi", "ISI", BUNDLE_MOCK_ISI)
        mat030 = next(c for c in cursos if c.codigo == "MAT030")
        assert mat030.creditos == 3

    def test_ciclo_nombre_asignado(self):
        cursos = extraer_malla_carrera("isi", "ISI", BUNDLE_MOCK_ISI)
        eif200 = next(c for c in cursos if c.codigo == "EIF200")
        assert eif200.ciclo_nombre == "Primer Año - I Ciclo"

    def test_codigo_normalizado_mayusculas(self):
        cursos = extraer_malla_carrera("isi", "ISI", BUNDLE_MOCK_ISI)
        for curso in cursos:
            assert curso.codigo == curso.codigo.upper()

    def test_ningún_campo_obligatorio_es_none(self):
        cursos = extraer_malla_carrera("isi", "ISI", BUNDLE_MOCK_ISI)
        for curso in cursos:
            assert curso.codigo
            assert curso.nombre
            assert curso.ciclo_nombre
            assert curso.carrera_sigla

    def test_optativo_marcado_correctamente(self):
        cursos = extraer_malla_carrera("isi", "ISI", BUNDLE_MOCK_ISI)
        eif420o = next((c for c in cursos if c.codigo == "EIF420O"), None)
        assert eif420o is not None
        assert eif420o.es_optativo is True

    def test_bundle_sin_bloque_isi_retorna_vacio(self):
        bundle_sin_isi = 'mesh:{"1 1":{TDC400:["Datos",[],3]}}'
        cursos = extraer_malla_carrera("isi", "ISI", bundle_sin_isi)
        assert cursos == []

    def test_todos_los_codigos_son_unicos(self):
        cursos = extraer_malla_carrera("isi", "ISI", BUNDLE_MOCK_ISI)
        codigos = [c.codigo for c in cursos]
        assert len(codigos) == len(set(codigos))


# ══════════════════════════════════════════════════════════════════════════════
# Tests de serialización
# ══════════════════════════════════════════════════════════════════════════════

class TestSerializacion:

    def test_serializa_a_dict(self):
        curso = CursoMalla(
            codigo="EIF201", nombre="Programación I", creditos=4,
            ciclo_id="1 2", ciclo_nombre="Primer Año - II Ciclo",
            carrera_sigla="isi", carrera_nombre="Ingeniería en Sistemas",
            prerequisitos=["EIF200", "MAT030"],
        )
        d = curso.to_dict()
        assert d["codigo"] == "EIF201"
        assert d["prerequisitos"] == ["EIF200", "MAT030"]

    def test_json_parseable_de_vuelta(self):
        curso = CursoMalla(
            codigo="EIF201", nombre="Programación I", creditos=4,
            ciclo_id="1 2", ciclo_nombre="Primer Año - II Ciclo",
            carrera_sigla="isi", carrera_nombre="Ingeniería en Sistemas",
        )
        json_str = json.dumps(curso.to_dict(), ensure_ascii=False)
        parsed = json.loads(json_str)
        assert parsed["codigo"] == "EIF201"
        assert "ó" in parsed["nombre"]